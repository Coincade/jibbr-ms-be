import { Server } from 'http';
import prisma from '../config/database.js';
import { checkMessageRateLimit } from '../services/rate-limiter.js';
import {
  removeClientFromAllChannels,
  addClientToChannel,
  removeClientFromAllConversations,
  addClientToConversation,
  validateChannelMembership,
  validateConversationParticipation,
} from './utils.js';
import {
  handleSendMessage,
  handleEditMessage,
  handleDeleteMessage,
  handleForwardMessage,
} from './handlers/message.handler.js';
import { handleAddReaction, handleRemoveReaction } from './handlers/reaction.handler.js';
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

// Global state for managing connections
let io: IoLike;
const channelClients: Map<string, Set<SocketLike>> = new Map();
const conversationClients: Map<string, Set<SocketLike>> = new Map();
const onlineUsers: Map<string, Set<SocketLike>> = new Map(); // userId -> Set of sockets
const userSockets: Map<string, string> = new Map(); // socketId -> userId

export const initializeWebSocketService = async (server: Server): Promise<IoLike> => {
  const {
    wss,
    io: wsIo,
    createSocketFromWs,
    authenticateFromRequestUrl,
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

  // Streams consumer broadcasts -> same io-like API
  (async () => {
    try {
      const { setSocketIOInstance, startStreamsConsumer } = await import(
        '../services/streams-consumer.service.js'
      );
      setSocketIOInstance(io as any);
      await startStreamsConsumer();
      console.log('✅ Streams consumer initialized for WebSocket broadcasting');
    } catch (error) {
      console.error('❌ Failed to initialize Streams consumer:', error);
    }
  })();

  wss.on('connection', (ws, req) => {
    (ws as any).isAlive = true;
    ws.on('pong', () => {
      (ws as any).isAlive = true;
    });

    const user = authenticateFromRequestUrl(req.url);
    if (!user) {
      try {
        ws.close(1008, 'Authentication required');
      } catch {
        // ignore
      }
      return;
    }

    const socket = createSocketFromWs(ws) as any as SocketLike & {
      _dispatchIncoming: (type: string, payload: any) => void;
    };
    socket.data.user = user as any;

    ws.on('message', (raw) => {
      const frame = parseIncomingFrame(raw);
      if (!frame) {
        socket.emit('error', { message: 'Invalid message format' });
        return;
      }
      socket._dispatchIncoming(frame.type, frame.data);
    });

    ws.on('close', (_code, reason) => {
      socket._dispatchIncoming('disconnect', String(reason || 'close'));
      getAllClients().delete(socket as any);
    });

    ws.on('error', (err) => {
      socket._dispatchIncoming('error', err);
    });

    handleConnection(socket);
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

  // Personal room for direct messaging + notifications
  socket.join(`user_${user.id}`);

  addUserToOnlineList(user.id, socket);
  userSockets.set(socket.id, user.id);
  broadcastUserOnlineStatus(user.id, true);

  socket.emit('authenticated', {
    userId: user.id,
    user: { id: user.id, name: user.name, email: user.email },
  });

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
    removeClientFromAllChannels(socket, channelClients);
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

  socket.on('leave_conversation', (data) => {
    const { conversationId } = data || {};
    if (!conversationId) return;
    removeClientFromAllConversations(socket, conversationClients);
    (socket.data as any).allowedConversations?.delete(conversationId);
    socket.emit('conversation_left', { conversationId });
  });

  socket.on('typing_start', (data) => {
    const { channelId } = data || {};
    if (!channelId) return;
    // DB-free hot path: only allow typing if the socket joined + was validated
    if (!(socket.data as any).allowedChannels?.has(channelId)) return;
    socket.to(channelId).emit('typing_start', { userId: user.id, userName: user.name, channelId });
  });

  socket.on('typing_stop', (data) => {
    const { channelId } = data || {};
    if (!channelId) return;
    if (!(socket.data as any).allowedChannels?.has(channelId)) return;
    socket.to(channelId).emit('typing_stop', { userId: user.id, userName: user.name, channelId });
  });

  socket.on('direct_typing_start', (data) => {
    const { conversationId } = data || {};
    if (!conversationId) return;
    if (!(socket.data as any).allowedConversations?.has(conversationId)) return;
    socket.to(conversationId).emit('direct_typing_start', {
      userId: user.id,
      userName: user.name,
      conversationId,
    });
  });

  socket.on('direct_typing_stop', (data) => {
    const { conversationId } = data || {};
    if (!conversationId) return;
    if (!(socket.data as any).allowedConversations?.has(conversationId)) return;
    socket.to(conversationId).emit('direct_typing_stop', {
      userId: user.id,
      userName: user.name,
      conversationId,
    });
  });

  socket.on('ping', () => {
    socket.emit('pong', { timestamp: Date.now() });
  });

  socket.on('mark_as_read', async (data) => {
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
};

const rateLimitOrError = (socket: SocketLike) => {
  const user = socket.data.user as any;
  if (!user?.id) return false;
  if (!checkMessageRateLimit(user.id, 1_000_000, 60 * 60 * 1000)) {
    socket.emit('error', { message: 'Rate limit exceeded. Please slow down.' });
    return false;
  }
  return true;
};

const handleSendMessageEvent = async (socket: SocketLike, data: any): Promise<void> => {
  try {
    if (!rateLimitOrError(socket)) return;
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
    if (!rateLimitOrError(socket)) return;
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

    const isStillOnline = onlineUsers.has(userId) && onlineUsers.get(userId)!.size > 0;
    if (!isStillOnline) {
      broadcastUserOnlineStatus(userId, false);
      setUserStatusToAway(userId);
    }
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

export const sendToUser = (userId: string, event: string, data: any) => {
  io.to(`user_${userId}`).emit(event, data);
};

const addUserToOnlineList = (userId: string, socket: SocketLike): void => {
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId)!.add(socket);
};

const removeUserFromOnlineList = (userId: string, socket: SocketLike): void => {
  if (!onlineUsers.has(userId)) return;
  onlineUsers.get(userId)!.delete(socket);
  if (onlineUsers.get(userId)!.size === 0) onlineUsers.delete(userId);
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

export const getOnlineUsers = (): string[] => Array.from(onlineUsers.keys());
export const isUserOnline = (userId: string): boolean =>
  onlineUsers.has(userId) && onlineUsers.get(userId)!.size > 0;
export const getUsersOnlineStatus = (userIds: string[]): Record<string, boolean> => {
  const status: Record<string, boolean> = {};
  userIds.forEach((id) => (status[id] = isUserOnline(id)));
  return status;
};
export const getOnlineUsersCount = (): number => onlineUsers.size;

