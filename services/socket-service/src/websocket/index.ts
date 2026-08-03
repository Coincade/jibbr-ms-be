import { Server } from 'http';
import prisma from '../config/database.js';
import {
  checkMessageRateLimit,
  getSocketMessageRateLimitConfig,
} from '../services/rate-limiter.js';
import {
  removeClientFromAllChannels,
  removeClientFromChannel,
  addClientToChannel,
  removeClientFromAllConversations,
  removeClientFromConversation,
  addClientToConversation,
  validateChannelMembership,
  validateConversationParticipation,
  validateWorkspaceMembership,
  getWorkspaceRoomKey,
} from './utils.js';
import {
  handleSendMessage,
  handleEditMessage,
  handleDeleteMessage,
  handleForwardMessage,
} from './handlers/message.handler.js';
import { handleAddReaction, handleRemoveReaction } from './handlers/reaction.handler.js';
import {
  fanoutWorkspaceHuddleFromChannel,
  fanoutWorkspaceHuddleFromConversation,
} from '../services/workspace-huddle-broadcast.service.js';
import {
  handleSendDirectMessage,
  handleEditDirectMessage,
  handleDeleteDirectMessage,
  handleAddDirectReaction,
  handleRemoveDirectReaction,
  handleForwardDirectMessage,
} from './handlers/direct-message.handler.js';
import { handleMarkAsRead } from './handlers/mark-as-read.handler.js';
import { createWsServer, type IoLike, type SocketLike } from './ws-compat.js';
import { warmMembershipCacheForUser } from '../services/socket-membership-cache.service.js';
import { checkSocketEventRateLimitDistributed } from '../services/socket-event-rate-limiter.service.js';
import {
  redisPresenceOnline,
  redisPresenceOffline,
  redisPresenceHeartbeat,
  redisGetOnlineUsers,
  redisIsUserOnline,
  redisGetUsersOnlineStatus,
} from '../services/presence-redis.service.js';

// Global state for managing connections
let io: IoLike;
const channelClients: Map<string, Set<SocketLike>> = new Map();
const conversationClients: Map<string, Set<SocketLike>> = new Map();
const onlineUsers: Map<string, Set<SocketLike>> = new Map(); // userId -> Set of sockets (local)
const userSockets: Map<string, string> = new Map(); // socketId -> userId

const AUTH_TIMEOUT_MS = 5_000;

export const initializeWebSocketService = async (server: Server): Promise<IoLike> => {
  const {
    wss,
    io: wsIo,
    createSocketFromWs,
    authenticateFromRequestUrl,
    authenticateFromProtocols,
    authenticateWithToken,
    parseIncomingFrame,
    getAllClients,
  } = createWsServer(server);

  io = wsIo;

  // Server-side heartbeat (native WS ping/pong) to kill half-open connections quickly.
  // This prevents long stalls and reduces tail latency under flaky networks.
  const HEARTBEAT_INTERVAL_MS = 25_000;
  const heartbeat = setInterval(() => {
    try {
      wss.clients.forEach((ws: any) => {
        if (ws.isAlive === false) {
          try {
            ws.terminate();
          } catch {
            // ignore
          }
          return;
        }
        ws.isAlive = false;
        try {
          ws.ping();
        } catch {
          try {
            ws.terminate();
          } catch {
            // ignore
          }
        }
      });
    } catch (err) {
      console.error('[ws] Heartbeat loop error:', err);
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => clearInterval(heartbeat));

  // Wire workspace huddle broadcast service to the native ws io instance
  const { setWorkspaceHuddleIo } = await import(
    '../services/workspace-huddle-broadcast.service.js'
  );
  setWorkspaceHuddleIo(io);

  // Streams consumer broadcasts -> same io-like API
  (async () => {
    try {
      const { setBroadcastIo, startStreamsConsumer } = await import(
        '../services/streams-consumer.service.js'
      );
      setBroadcastIo(io);
      await startStreamsConsumer();
      console.log('✅ Streams consumer initialized for WebSocket broadcasting');
    } catch (error) {
      console.error('❌ Failed to initialize Streams consumer:', error);
    }
  })();

  const attachAuthenticatedSocket = (ws: any, user: { id: string; name?: string; email?: string; image?: string }) => {
    const socket = createSocketFromWs(ws) as any as SocketLike & {
      _dispatchIncoming: (type: string, payload: any) => void;
    };
    socket.data.user = user as any;

    ws.on('message', (raw: any) => {
      const frame = parseIncomingFrame(raw);
      if (!frame) {
        socket.emit('error', { message: 'Invalid message format' });
        return;
      }
      socket._dispatchIncoming(frame.type, frame.data);
    });

    ws.on('close', (_code: number, reason: any) => {
      socket._dispatchIncoming('disconnect', String(reason || 'close'));
      getAllClients().delete(socket as any);
    });

    ws.on('error', (err: Error) => {
      socket._dispatchIncoming('error', err);
    });

    handleConnection(socket);
  };

  wss.on('connection', async (ws, req) => {
    (ws as any).isAlive = true;
    ws.on('pong', () => {
      (ws as any).isAlive = true;
    });

    // Prefer subprotocol / first-message auth; query `?token=` kept as migration fallback.
    let user =
      (await authenticateFromProtocols(req)) ||
      (await authenticateFromRequestUrl(req.url));

    if (user) {
      attachAuthenticatedSocket(ws, user);
      return;
    }

    const authTimer = setTimeout(() => {
      try {
        ws.close(1008, 'Authentication required');
      } catch {
        // ignore
      }
    }, AUTH_TIMEOUT_MS);

    const onAuthMessage = async (raw: any) => {
      const frame = parseIncomingFrame(raw);
      if (!frame || frame.type !== 'auth') {
        try {
          ws.send(JSON.stringify({ type: 'error', message: 'Authentication required' }));
        } catch {
          // ignore
        }
        return;
      }
      const token = typeof frame.data?.token === 'string' ? frame.data.token : '';
      user = await authenticateWithToken(token);
      if (!user) {
        clearTimeout(authTimer);
        try {
          ws.close(1008, 'Authentication required');
        } catch {
          // ignore
        }
        return;
      }
      clearTimeout(authTimer);
      ws.off('message', onAuthMessage);
      attachAuthenticatedSocket(ws, user);
    };

    ws.on('message', onAuthMessage);
  });

  return io;
};

const handleConnection = (socket: SocketLike): void => {
  const user = socket.data.user as any;
  if (!user?.id) {
    socket.disconnect(1008, 'No user');
    return;
  }

  // Cache per-socket authorization so hot paths (typing/presence) stay DB-free.
  // Populated on join_* events after validation.
  (socket.data as any).allowedChannels = new Set<string>();
  (socket.data as any).allowedConversations = new Set<string>();
  (socket.data as any).allowedWorkspaces = new Set<string>();

  // Personal room for direct messaging + notifications
  socket.join(`user_${user.id}`);

  addUserToOnlineList(user.id, socket);
  userSockets.set(socket.id, user.id);

  // Register handlers before `authenticated` so join_* events are never missed.
  // Membership cache must be warm before the client runs join_workspace; otherwise
  // validateWorkspaceMembershipCached can see Redis miss and reject valid members.
  socket.on('send_message', async (data) => handleSendMessageEvent(socket, data));
  socket.on('edit_message', async (data) => handleEditMessageEvent(socket, data));
  socket.on('delete_message', async (data) => handleDeleteMessageEvent(socket, data));
  socket.on('forward_message', async (data) => handleForwardMessageEvent(socket, data));
  socket.on('forward_to_direct', async (data) => handleForwardToDirectEvent(socket, data));

  socket.on('add_reaction', async (data) => handleAddReactionEvent(socket, data));
  socket.on('remove_reaction', async (data) => handleRemoveReactionEvent(socket, data));

  socket.on('send_direct_message', async (data) => handleSendDirectMessageEvent(socket, data));
  socket.on('edit_direct_message', async (data) => handleEditDirectMessageEvent(socket, data));
  socket.on('delete_direct_message', async (data) => handleDeleteDirectMessageEvent(socket, data));
  socket.on('add_direct_reaction', async (data) => handleAddDirectReactionEvent(socket, data));
  socket.on('remove_direct_reaction', async (data) => handleRemoveDirectReactionEvent(socket, data));

  socket.on('join_channel', async (data) => {
    const { channelId } = data || {};
    if (!channelId) return;
    const isMember = await validateChannelMembership(user.id, channelId);
    if (!isMember) {
      socket.emit('error', { message: 'You are not a member of this channel' });
      return;
    }
    (socket.data as any).allowedChannels?.add(channelId);
    addClientToChannel(socket, channelId, channelClients);
    socket.emit('joined_channel', { channelId });
  });

  socket.on('leave_channel', (data) => {
    const { channelId } = data || {};
    if (!channelId) return;
    removeClientFromChannel(socket, channelId, channelClients);
    (socket.data as any).allowedChannels?.delete(channelId);
    socket.emit('left_channel', { channelId });
  });

  socket.on('join_conversation', async (data) => {
    const { conversationId } = data || {};
    if (!conversationId) return;
    const isParticipant = await validateConversationParticipation(user.id, conversationId);
    if (!isParticipant) {
      socket.emit('error', { message: 'You are not a participant of this conversation' });
      return;
    }
    (socket.data as any).allowedConversations?.add(conversationId);
    addClientToConversation(socket, conversationId, conversationClients);
    socket.emit('conversation_joined', { conversationId });
  });

  socket.on('join_workspace', async (data) => {
    const { workspaceId } = data || {};
    if (!workspaceId) return;
    const isMember = await validateWorkspaceMembership(user.id, workspaceId);
    if (!isMember) {
      socket.emit('error', { message: 'You are not a member of this workspace' });
      return;
    }
    (socket.data as any).allowedWorkspaces?.add(workspaceId);
    socket.join(getWorkspaceRoomKey(workspaceId));
    socket.emit('joined_workspace', { workspaceId });
  });

  socket.on('leave_workspace', (data) => {
    const { workspaceId } = data || {};
    if (!workspaceId) return;
    (socket.data as any).allowedWorkspaces?.delete(workspaceId);
    socket.leave(getWorkspaceRoomKey(workspaceId));
    socket.emit('left_workspace', { workspaceId });
  });

  socket.on('leave_conversation', (data) => {
    const { conversationId } = data || {};
    if (!conversationId) return;
    removeClientFromConversation(socket, conversationId, conversationClients);
    (socket.data as any).allowedConversations?.delete(conversationId);
    socket.emit('conversation_left', { conversationId });
  });

  socket.on('typing_start', async (data) => {
    const { channelId } = data || {};
    if (!channelId) return;
    if (!(await checkSocketEventRateLimitDistributed(user.id, 'typing'))) return;
    // DB-free hot path: only allow typing if the socket joined + was validated
    if (!(socket.data as any).allowedChannels?.has(channelId)) return;
    socket.to(channelId).emit('typing_start', { userId: user.id, userName: user.name, channelId });
  });

  socket.on('typing_stop', async (data) => {
    const { channelId } = data || {};
    if (!channelId) return;
    if (!(await checkSocketEventRateLimitDistributed(user.id, 'typing'))) return;
    if (!(socket.data as any).allowedChannels?.has(channelId)) return;
    socket.to(channelId).emit('typing_stop', { userId: user.id, userName: user.name, channelId });
  });

  socket.on('direct_typing_start', async (data) => {
    const { conversationId } = data || {};
    if (!conversationId) return;
    if (!(await checkSocketEventRateLimitDistributed(user.id, 'typing'))) return;
    if (!(socket.data as any).allowedConversations?.has(conversationId)) return;
    socket.to(conversationId).emit('direct_typing_start', {
      userId: user.id,
      userName: user.name,
      conversationId,
    });
  });

  socket.on('direct_typing_stop', async (data) => {
    const { conversationId } = data || {};
    if (!conversationId) return;
    if (!(await checkSocketEventRateLimitDistributed(user.id, 'typing'))) return;
    if (!(socket.data as any).allowedConversations?.has(conversationId)) return;
    socket.to(conversationId).emit('direct_typing_stop', {
      userId: user.id,
      userName: user.name,
      conversationId,
    });
  });

  // Channel huddle / call presence (media via call-service + mediasoup)
  socket.on('channel_call_start', async (data) => {
    const { channelId } = data || {};
    if (!channelId) return;
    if (!(await checkSocketEventRateLimitDistributed(user.id, 'presence'))) return;
    const isMember = await validateChannelMembership(user.id, channelId);
    if (!isMember) {
      socket.emit('error', { message: 'You are not a member of this channel' });
      return;
    }
    (socket.data as any).allowedChannels?.add(channelId);
    addClientToChannel(socket, channelId, channelClients);
    socket.to(channelId).emit('channel_call_started', {
      channelId,
      startedBy: user.id,
      startedByName: user.name,
      timestamp: new Date().toISOString(),
    });
    socket.emit('channel_call_started', {
      channelId,
      startedBy: user.id,
      startedByName: user.name,
      timestamp: new Date().toISOString(),
    });
    void fanoutWorkspaceHuddleFromChannel(channelId, {
      active: true,
      participantCount: 1,
      hostUserId: user.id,
      startedByName: user.name,
    });
  });

  socket.on('channel_call_join', async (data) => {
    const { channelId, sessionId } = data || {};
    if (!channelId) return;
    if (!(await checkSocketEventRateLimitDistributed(user.id, 'presence'))) return;
    const isMember = await validateChannelMembership(user.id, channelId);
    if (!isMember) {
      socket.emit('error', { message: 'You are not a member of this channel' });
      return;
    }
    (socket.data as any).allowedChannels?.add(channelId);
    addClientToChannel(socket, channelId, channelClients);
    socket.to(channelId).emit('channel_call_participant_joined', {
      channelId,
      sessionId,
      userId: user.id,
      userName: user.name,
      timestamp: new Date().toISOString(),
    });
    // Do not fan sparse { active: true } — call-service emits authoritative presence.
  });

  socket.on('channel_call_leave', async (data) => {
    const { channelId } = data || {};
    if (!channelId) return;
    if (!(socket.data as any).allowedChannels?.has(channelId)) return;
    socket.to(channelId).emit('channel_call_participant_left', {
      channelId,
      userId: user.id,
      timestamp: new Date().toISOString(),
    });
  });

  const relayProducerClosed = (
    scope: 'channel' | 'conversation',
    data: {
      channelId?: string;
      conversationId?: string;
      producerId?: string;
      userId?: string;
      kind?: string;
      source?: string;
    }
  ) => {
    if (!data.producerId) return;
    const payload = {
      ...data,
      // Never trust client-supplied userId for producer closed (spoofing).
      userId: user.id,
      timestamp: new Date().toISOString(),
    };
    if (scope === 'channel' && data.channelId) {
      socket.to(data.channelId).emit('channel_call_producer_closed', payload);
    }
    if (scope === 'conversation' && data.conversationId) {
      socket.to(data.conversationId).emit('conversation_call_producer_closed', payload);
    }
  };

  socket.on('channel_call_producer_closed', async (data) => {
    const { channelId } = data || {};
    if (!channelId) return;
    if (!(socket.data as any).allowedChannels?.has(channelId)) return;
    relayProducerClosed('channel', data);
  });

  socket.on('conversation_call_producer_closed', async (data) => {
    const { conversationId } = data || {};
    if (!conversationId) return;
    if (!(socket.data as any).allowedConversations?.has(conversationId)) return;
    relayProducerClosed('conversation', data);
  });

  socket.on('channel_call_producer_ready', async (data) => {
    const { channelId, producerId, kind, sessionId, source } = data || {};
    if (!channelId || !producerId) return;
    if (!(socket.data as any).allowedChannels?.has(channelId)) {
      const isMember = await validateChannelMembership(user.id, channelId);
      if (!isMember) return;
      (socket.data as any).allowedChannels?.add(channelId);
      addClientToChannel(socket, channelId, channelClients);
    }
    socket.to(channelId).emit('channel_call_new_producer', {
      channelId,
      sessionId,
      producerId,
      kind,
      source: source === 'screen' ? 'screen' : kind === 'video' ? 'camera' : undefined,
      userId: user.id,
      userName: user.name,
    });
  });

  socket.on('channel_call_mute', async (data) => {
    const { channelId, audioMuted, videoMuted } = data || {};
    if (!channelId) return;
    if (!(socket.data as any).allowedChannels?.has(channelId)) return;
    socket.to(channelId).emit('channel_call_participant_updated', {
      channelId,
      userId: user.id,
      audioMuted: !!audioMuted,
      videoMuted: !!videoMuted,
    });
  });

  socket.on('channel_call_annotation_stroke', async (data) => {
    const { channelId, stroke, sessionId } = data || {};
    if (!channelId || !stroke?.id) return;
    if (!(socket.data as any).allowedChannels?.has(channelId)) return;
    socket.to(channelId).emit('channel_call_annotation_stroke', {
      channelId,
      sessionId,
      stroke: {
        ...stroke,
        authorUserId: user.id,
        authorName: user.name,
      },
    });
  });

  socket.on('channel_call_annotation_clear', async (data) => {
    const { channelId, screenOwnerUserId, sessionId } = data || {};
    if (!channelId || !screenOwnerUserId) return;
    if (!(socket.data as any).allowedChannels?.has(channelId)) return;
    io.to(channelId).emit('channel_call_annotation_clear', {
      channelId,
      screenOwnerUserId,
      sessionId,
      clearedBy: user.id,
    });
  });

  socket.on('channel_call_annotation_permission', async (data) => {
    const { channelId, screenOwnerUserId, allowOthersToDraw, sessionId } = data || {};
    if (!channelId || !screenOwnerUserId) return;
    if (user.id !== screenOwnerUserId) return;
    if (!(socket.data as any).allowedChannels?.has(channelId)) return;
    socket.to(channelId).emit('channel_call_annotation_permission', {
      channelId,
      screenOwnerUserId,
      allowOthersToDraw: !!allowOthersToDraw,
      sessionId,
      updatedBy: user.id,
    });
  });

  socket.on('channel_call_annotation_erase', async (data) => {
    const { channelId, screenOwnerUserId, strokeIds, sessionId } = data || {};
    if (!channelId || !screenOwnerUserId || !Array.isArray(strokeIds) || !strokeIds.length) return;
    if (!(socket.data as any).allowedChannels?.has(channelId)) return;
    socket.to(channelId).emit('channel_call_annotation_erase', {
      channelId,
      screenOwnerUserId,
      strokeIds,
      sessionId,
      erasedBy: user.id,
    });
  });

  socket.on('channel_call_end', async (data) => {
    const { channelId } = data || {};
    if (!channelId) return;
    if (!(await checkSocketEventRateLimitDistributed(user.id, 'presence'))) return;
    // Re-validate membership (allowedChannels can be stale after revoke).
    const isMember = await validateChannelMembership(user.id, channelId);
    if (!isMember) {
      socket.emit('error', { message: 'You are not a member of this channel' });
      return;
    }

    // While the SFU room is still live, only the host may fan out "ended".
    // Empty/inactive rooms may be cleared by any member (last-leave cleanup).
    const { fetchCallRoomHostStatus } = await import('../services/call-kick.service.js');
    const hostStatus = await fetchCallRoomHostStatus({ userId: user.id, channelId });
    if (
      hostStatus?.active &&
      hostStatus.participantCount > 0 &&
      !hostStatus.isHost
    ) {
      socket.emit('error', {
        message: 'Only the huddle host can end the call for everyone',
      });
      return;
    }

    (socket.data as any).allowedChannels?.add(channelId);
    // Presence-only signal for peers; mediasoup close is owned by call-service (host HTTP end / last leave).
    io.to(channelId).emit('channel_call_ended', {
      channelId,
      endedBy: user.id,
      timestamp: new Date().toISOString(),
    });
    void fanoutWorkspaceHuddleFromChannel(channelId, { active: false });
  });

  // DM / conversation huddle (same mediasoup room id: conv:{conversationId})
  socket.on('conversation_call_start', async (data) => {
    const { conversationId } = data || {};
    if (!conversationId) return;
    if (!(await checkSocketEventRateLimitDistributed(user.id, 'presence'))) return;
    const ok = await validateConversationParticipation(user.id, conversationId);
    if (!ok) {
      socket.emit('error', { message: 'You are not a participant in this conversation' });
      return;
    }
    (socket.data as any).allowedConversations?.add(conversationId);
    addClientToConversation(socket, conversationId, conversationClients);
    const payload = {
      conversationId,
      startedBy: user.id,
      startedByName: user.name,
      timestamp: new Date().toISOString(),
    };
    socket.to(conversationId).emit('conversation_call_started', payload);
    socket.emit('conversation_call_started', payload);
    void fanoutWorkspaceHuddleFromConversation(conversationId, {
      active: true,
      participantCount: 1,
      hostUserId: user.id,
      startedByName: user.name,
    });
  });

  socket.on('conversation_call_join', async (data) => {
    const { conversationId, sessionId } = data || {};
    if (!conversationId) return;
    if (!(await checkSocketEventRateLimitDistributed(user.id, 'presence'))) return;
    const ok = await validateConversationParticipation(user.id, conversationId);
    if (!ok) {
      socket.emit('error', { message: 'You are not a participant in this conversation' });
      return;
    }
    (socket.data as any).allowedConversations?.add(conversationId);
    addClientToConversation(socket, conversationId, conversationClients);
    socket.to(conversationId).emit('conversation_call_participant_joined', {
      conversationId,
      sessionId,
      userId: user.id,
      userName: user.name,
      timestamp: new Date().toISOString(),
    });
    // Do not fan sparse { active: true } — call-service emits authoritative presence.
  });

  socket.on('conversation_call_leave', async (data) => {
    const { conversationId } = data || {};
    if (!conversationId) return;
    if (!(socket.data as any).allowedConversations?.has(conversationId)) return;
    socket.to(conversationId).emit('conversation_call_participant_left', {
      conversationId,
      userId: user.id,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on('conversation_call_producer_ready', async (data) => {
    const { conversationId, producerId, kind, sessionId, source } = data || {};
    if (!conversationId || !producerId) return;
    if (!(socket.data as any).allowedConversations?.has(conversationId)) {
      const allowed = await validateConversationParticipation(user.id, conversationId);
      if (!allowed) return;
      (socket.data as any).allowedConversations?.add(conversationId);
      addClientToConversation(socket, conversationId, conversationClients);
    }
    socket.to(conversationId).emit('conversation_call_new_producer', {
      conversationId,
      sessionId,
      producerId,
      kind,
      source: source === 'screen' ? 'screen' : kind === 'video' ? 'camera' : undefined,
      userId: user.id,
      userName: user.name,
    });
  });

  socket.on('conversation_call_mute', async (data) => {
    const { conversationId, audioMuted, videoMuted } = data || {};
    if (!conversationId) return;
    if (!(socket.data as any).allowedConversations?.has(conversationId)) return;
    socket.to(conversationId).emit('conversation_call_participant_updated', {
      conversationId,
      userId: user.id,
      audioMuted: !!audioMuted,
      videoMuted: !!videoMuted,
    });
  });

  socket.on('conversation_call_annotation_stroke', async (data) => {
    const { conversationId, stroke, sessionId } = data || {};
    if (!conversationId || !stroke?.id) return;
    if (!(socket.data as any).allowedConversations?.has(conversationId)) return;
    socket.to(conversationId).emit('conversation_call_annotation_stroke', {
      conversationId,
      sessionId,
      stroke: {
        ...stroke,
        authorUserId: user.id,
        authorName: user.name,
      },
    });
  });

  socket.on('conversation_call_annotation_clear', async (data) => {
    const { conversationId, screenOwnerUserId, sessionId } = data || {};
    if (!conversationId || !screenOwnerUserId) return;
    if (!(socket.data as any).allowedConversations?.has(conversationId)) return;
    io.to(conversationId).emit('conversation_call_annotation_clear', {
      conversationId,
      screenOwnerUserId,
      sessionId,
      clearedBy: user.id,
    });
  });

  socket.on('conversation_call_annotation_permission', async (data) => {
    const { conversationId, screenOwnerUserId, allowOthersToDraw, sessionId } = data || {};
    if (!conversationId || !screenOwnerUserId) return;
    if (user.id !== screenOwnerUserId) return;
    if (!(socket.data as any).allowedConversations?.has(conversationId)) return;
    socket.to(conversationId).emit('conversation_call_annotation_permission', {
      conversationId,
      screenOwnerUserId,
      allowOthersToDraw: !!allowOthersToDraw,
      sessionId,
      updatedBy: user.id,
    });
  });

  socket.on('conversation_call_annotation_erase', async (data) => {
    const { conversationId, screenOwnerUserId, strokeIds, sessionId } = data || {};
    if (!conversationId || !screenOwnerUserId || !Array.isArray(strokeIds) || !strokeIds.length) return;
    if (!(socket.data as any).allowedConversations?.has(conversationId)) return;
    socket.to(conversationId).emit('conversation_call_annotation_erase', {
      conversationId,
      screenOwnerUserId,
      strokeIds,
      sessionId,
      erasedBy: user.id,
    });
  });

  socket.on('conversation_call_end', async (data) => {
    const { conversationId } = data || {};
    if (!conversationId) return;
    if (!(await checkSocketEventRateLimitDistributed(user.id, 'presence'))) return;
    const ok = await validateConversationParticipation(user.id, conversationId);
    if (!ok) {
      socket.emit('error', { message: 'You are not a participant in this conversation' });
      return;
    }

    const { fetchCallRoomHostStatus } = await import('../services/call-kick.service.js');
    const hostStatus = await fetchCallRoomHostStatus({
      userId: user.id,
      conversationId,
    });
    if (
      hostStatus?.active &&
      hostStatus.participantCount > 0 &&
      !hostStatus.isHost
    ) {
      socket.emit('error', {
        message: 'Only the huddle host can end the call for everyone',
      });
      return;
    }

    (socket.data as any).allowedConversations?.add(conversationId);
    io.to(conversationId).emit('conversation_call_ended', {
      conversationId,
      endedBy: user.id,
      timestamp: new Date().toISOString(),
    });
    void fanoutWorkspaceHuddleFromConversation(conversationId, { active: false });
  });

  socket.on('ping', () => {
    void redisPresenceHeartbeat(user.id);
    socket.emit('pong', { timestamp: Date.now() });
  });

  socket.on('mark_as_read', async (data) => {
    if (!(await checkSocketEventRateLimitDistributed(user.id, 'presence'))) {
      socket.emit('error', { message: 'Rate limit exceeded. Please slow down.' });
      return;
    }
    await handleMarkAsRead(socket as any, data);
  });

  socket.on('disconnect', (reason) => {
    console.log(`Socket disconnected: ${socket.id}, reason: ${reason}`);
    handleDisconnection(socket);
  });

  socket.on('error', (error) => {
    console.error('Socket error:', error);
    handleDisconnection(socket);
  });

  void (async () => {
    try {
      await warmMembershipCacheForUser(user.id);
    } catch (error) {
      console.error('[socket] Failed to warm membership cache:', error);
    }

    socket.emit('authenticated', {
      userId: user.id,
      user: { id: user.id, name: user.name, email: user.email },
    });
  })();
};

const rateLimitOrError = async (socket: SocketLike) => {
  const user = socket.data.user as any;
  if (!user?.id) return false;
  if (!(await checkSocketEventRateLimitDistributed(user.id, 'message'))) {
    socket.emit('error', { message: 'Rate limit exceeded. Please slow down.' });
    return false;
  }
  const { maxMessages, windowMs } = getSocketMessageRateLimitConfig();
  if (!checkMessageRateLimit(user.id, maxMessages, windowMs)) {
    socket.emit('error', { message: 'Rate limit exceeded. Please slow down.' });
    return false;
  }
  return true;
};

const handleSendMessageEvent = async (socket: SocketLike, data: any): Promise<void> => {
  try {
    if (!(await rateLimitOrError(socket))) return;
    addClientToChannel(socket, data.channelId, channelClients);
    await handleSendMessage(socket as any, data, channelClients as any, io as any);
  } catch (error) {
    console.error('Error handling send message:', error);
    socket.emit('error', { message: 'Failed to send message' });
  }
};

const handleEditMessageEvent = async (socket: SocketLike, data: any): Promise<void> => {
  try {
    await handleEditMessage(socket as any, data, channelClients as any, io as any);
  } catch (error) {
    console.error('Error handling edit message:', error);
    socket.emit('error', { message: 'Failed to edit message' });
  }
};

const handleDeleteMessageEvent = async (socket: SocketLike, data: any): Promise<void> => {
  try {
    await handleDeleteMessage(socket as any, data, channelClients as any);
  } catch (error) {
    console.error('Error handling delete message:', error);
    socket.emit('error', { message: 'Failed to delete message' });
  }
};

const handleForwardMessageEvent = async (socket: SocketLike, data: any): Promise<void> => {
  try {
    await handleForwardMessage(socket as any, data, channelClients as any);
  } catch (error) {
    console.error('Error handling forward message:', error);
    socket.emit('error', { message: 'Failed to forward message' });
  }
};

const handleForwardToDirectEvent = async (socket: SocketLike, data: any): Promise<void> => {
  try {
    await handleForwardDirectMessage(socket as any, data, conversationClients as any);
  } catch (error) {
    console.error('Error handling forward to direct message:', error);
    socket.emit('error', { message: 'Failed to forward message to direct conversation' });
  }
};

const handleAddReactionEvent = async (socket: SocketLike, data: any): Promise<void> => {
  try {
    await handleAddReaction(socket as any, data, channelClients as any);
  } catch (error) {
    console.error('Error handling add reaction:', error);
    socket.emit('error', { message: 'Failed to add reaction' });
  }
};

const handleRemoveReactionEvent = async (socket: SocketLike, data: any): Promise<void> => {
  try {
    await handleRemoveReaction(socket as any, data, channelClients as any);
  } catch (error) {
    console.error('Error handling remove reaction:', error);
    socket.emit('error', { message: 'Failed to remove reaction' });
  }
};

const handleSendDirectMessageEvent = async (socket: SocketLike, data: any): Promise<void> => {
  try {
    if (!(await rateLimitOrError(socket))) return;
    addClientToConversation(socket, data.conversationId, conversationClients);
    await handleSendDirectMessage(socket as any, data, conversationClients as any, io as any);
  } catch (error) {
    console.error('Error handling send direct message:', error);
    socket.emit('error', { message: 'Failed to send direct message' });
  }
};

const handleEditDirectMessageEvent = async (socket: SocketLike, data: any): Promise<void> => {
  try {
    await handleEditDirectMessage(socket as any, data, conversationClients as any);
  } catch (error) {
    console.error('Error handling edit direct message:', error);
    socket.emit('error', { message: 'Failed to edit direct message' });
  }
};

const handleDeleteDirectMessageEvent = async (socket: SocketLike, data: any): Promise<void> => {
  try {
    await handleDeleteDirectMessage(socket as any, data, conversationClients as any);
  } catch (error) {
    console.error('Error handling delete direct message:', error);
    socket.emit('error', { message: 'Failed to delete direct message' });
  }
};

const handleAddDirectReactionEvent = async (socket: SocketLike, data: any): Promise<void> => {
  try {
    await handleAddDirectReaction(socket as any, data, conversationClients as any);
  } catch (error) {
    console.error('Error handling add direct reaction:', error);
    socket.emit('error', { message: 'Failed to add reaction' });
  }
};

const handleRemoveDirectReactionEvent = async (socket: SocketLike, data: any): Promise<void> => {
  try {
    await handleRemoveDirectReaction(socket as any, data, conversationClients as any);
  } catch (error) {
    console.error('Error handling remove direct reaction:', error);
    socket.emit('error', { message: 'Failed to remove reaction' });
  }
};

const handleDisconnection = (socket: SocketLike): void => {
  const userId = userSockets.get(socket.id);
  if (userId) {
    removeUserFromOnlineList(userId, socket);
    userSockets.delete(socket.id);
  }

  removeClientFromAllChannels(socket, channelClients);
  removeClientFromAllConversations(socket, conversationClients);
};

export const getWebSocketStats = () => {
  const channelStats: Record<string, number> = {};
  for (const [channelId, clients] of channelClients.entries()) channelStats[channelId] = clients.size;

  const conversationStats: Record<string, number> = {};
  for (const [conversationId, clients] of conversationClients.entries())
    conversationStats[conversationId] = clients.size;

  return {
    totalConnections: io.clientsCount(),
    channelStats,
    conversationStats,
  };
};

export const broadcastToChannel = (channelId: string, event: string, data: any) => {
  io.to(channelId).emit(event, data);
};

export const broadcastToConversation = (conversationId: string, event: string, data: any) => {
  io.to(conversationId).emit(event, data);
};

export const broadcastWorkspaceHuddleUpdate = (
  workspaceId: string,
  event: string,
  data: any
) => {
  io.to(getWorkspaceRoomKey(workspaceId)).emit(event, data);
};

export const broadcastChatMessage = (
  roomId: string,
  scope: 'channel' | 'conversation',
  message: any
) => {
  if (scope === 'channel') {
    io.to(roomId).emit('new_message', message);
    return;
  }
  io.to(roomId).emit('new_direct_message', message);
};

export const sendToUser = (userId: string, event: string, data: any) => {
  io.to(`user_${userId}`).emit(event, data);
};

/**
 * Clear per-socket channel privileges, leave the room, and notify the user.
 * Used when membership is revoked so stale allowedChannels cannot keep Jabbr signaling alive.
 */
export const revokeUserChannelAccess = (userId: string, channelId: string): void => {
  const sockets = onlineUsers.get(userId);
  if (sockets) {
    for (const socket of sockets) {
      (socket.data as any).allowedChannels?.delete(channelId);
      removeClientFromChannel(socket, channelId, channelClients);
    }
  }
  sendToUser(userId, 'channel_access_revoked', {
    channelId,
    reason: 'membership_removed',
    timestamp: new Date().toISOString(),
  });
};

/**
 * Clear per-socket conversation privileges, leave the room, and notify the user.
 */
export const revokeUserConversationAccess = (userId: string, conversationId: string): void => {
  const sockets = onlineUsers.get(userId);
  if (sockets) {
    for (const socket of sockets) {
      (socket.data as any).allowedConversations?.delete(conversationId);
      removeClientFromConversation(socket, conversationId, conversationClients);
    }
  }
  sendToUser(userId, 'conversation_access_revoked', {
    conversationId,
    reason: 'membership_removed',
    timestamp: new Date().toISOString(),
  });
};

const addUserToOnlineList = (userId: string, socket: SocketLike): void => {
  const wasOffline = !onlineUsers.has(userId) || onlineUsers.get(userId)!.size === 0;
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId)!.add(socket);
  void redisPresenceOnline(userId).then(() => {
    if (wasOffline) broadcastUserOnlineStatus(userId, true);
  });
};

const removeUserFromOnlineList = (userId: string, socket: SocketLike): void => {
  if (!onlineUsers.has(userId)) return;
  onlineUsers.get(userId)!.delete(socket);
  if (onlineUsers.get(userId)!.size === 0) {
    onlineUsers.delete(userId);
    void redisPresenceOffline(userId).then((stillOnlineElsewhere) => {
      if (!stillOnlineElsewhere) {
        broadcastUserOnlineStatus(userId, false);
        setUserStatusToAway(userId);
      }
    });
  } else {
    void redisPresenceOffline(userId);
  }
};

const broadcastUserOnlineStatus = (userId: string, isOnline: boolean): void => {
  io.emit('user_status_change', {
    userId,
    isOnline,
    timestamp: new Date().toISOString(),
  });
};

const setUserStatusToAway = (userId: string): void => {
  prisma.user
    .update({
      where: { id: userId },
      data: { presenceStatus: 'away' } as { presenceStatus: 'away' },
    })
    .then(() => {
      io.emit('user_set_status_change', { userId, status: 'away', customMessage: '' });
    })
    .catch((err) => console.error(`[socket] Failed to set user ${userId} status to away:`, err));
};

export const getOnlineUsers = async (): Promise<string[]> => {
  const fromRedis = await redisGetOnlineUsers();
  if (fromRedis.length > 0) return fromRedis;
  return Array.from(onlineUsers.keys());
};
export const isUserOnline = async (userId: string): Promise<boolean> => {
  const redisOnline = await redisIsUserOnline(userId);
  if (redisOnline) return true;
  return onlineUsers.has(userId) && onlineUsers.get(userId)!.size > 0;
};
export const getUsersOnlineStatus = async (
  userIds: string[]
): Promise<Record<string, boolean>> => {
  const fromRedis = await redisGetUsersOnlineStatus(userIds);
  const status: Record<string, boolean> = { ...fromRedis };
  userIds.forEach((id) => {
    if (!status[id]) {
      status[id] = onlineUsers.has(id) && onlineUsers.get(id)!.size > 0;
    }
  });
  return status;
};
export const getOnlineUsersCount = async (): Promise<number> => {
  const users = await getOnlineUsers();
  return users.length;
};

