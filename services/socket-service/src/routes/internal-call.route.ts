import { Router, type Request, type Response } from 'express';
import {
  broadcastToChannel,
  broadcastToConversation,
  broadcastWorkspaceHuddleUpdate,
  broadcastChatMessage,
} from '../websocket/index.js';
import {
  fanoutWorkspaceHuddleFromChannel,
  fanoutWorkspaceHuddleFromConversation,
} from '../services/workspace-huddle-broadcast.service.js';

const router = Router();

const verifyInternal = (req: Request, res: Response): boolean => {
  const expected = process.env.INTERNAL_SERVICE_SECRET?.trim();
  if (!expected) {
    res.status(503).json({ error: 'Internal signaling not configured' });
    return false;
  }
  const provided = req.header('X-Internal-Secret');
  if (provided !== expected) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
};

/**
 * Server-to-server huddle broadcasts (e.g. call-service producer lifecycle).
 */
router.post('/call/broadcast', (req: Request, res: Response) => {
  if (!verifyInternal(req, res)) return;

  const { channelId, conversationId, event, data } = req.body ?? {};
  if (!event || typeof event !== 'string') {
    res.status(400).json({ error: 'event is required' });
    return;
  }

  const payload = { ...(data ?? {}), timestamp: new Date().toISOString() };

  if (conversationId) {
    broadcastToConversation(String(conversationId), event, {
      ...payload,
      conversationId: String(conversationId),
    });
  } else if (channelId) {
    broadcastToChannel(String(channelId), event, {
      ...payload,
      channelId: String(channelId),
    });
  } else {
    res.status(400).json({ error: 'channelId or conversationId required' });
    return;
  }

  res.json({ ok: true });
});

/**
 * Huddle presence patches. Prefer channel/conversation scoping — never fan out a
 * channel Jabbr to an entire workspace (non-members must not see it).
 */
router.post('/call/broadcast-workspace', async (req: Request, res: Response) => {
  if (!verifyInternal(req, res)) return;

  const { workspaceId, event, data } = req.body ?? {};
  if (!workspaceId) {
    res.status(400).json({ error: 'workspaceId is required' });
    return;
  }

  const eventName =
    typeof event === 'string' && event.length > 0 ? event : 'workspace_huddle_updated';
  const payload = { ...(data ?? {}) };
  const channelId =
    typeof payload.channelId === 'string'
      ? payload.channelId
      : typeof payload.roomId === 'string' && !String(payload.roomId).startsWith('conv:')
        ? payload.roomId
        : null;
  const conversationId =
    typeof payload.conversationId === 'string'
      ? payload.conversationId
      : typeof payload.roomId === 'string' && String(payload.roomId).startsWith('conv:')
        ? String(payload.roomId).slice('conv:'.length)
        : null;

  try {
    if (channelId) {
      await fanoutWorkspaceHuddleFromChannel(channelId, payload);
    } else if (conversationId) {
      await fanoutWorkspaceHuddleFromConversation(conversationId, payload);
    } else if (eventName === 'workspace_huddle_updated') {
      // Refuse unscoped huddle presence — would leak to non-members.
      res.status(400).json({
        error: 'channelId or conversationId required for workspace_huddle_updated',
      });
      return;
    } else {
      broadcastWorkspaceHuddleUpdate(String(workspaceId), eventName, payload);
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('[internal-call] broadcast-workspace failed:', error);
    res.status(500).json({ error: 'Failed to broadcast' });
  }
});

router.post('/call/broadcast-message', (req: Request, res: Response) => {
  if (!verifyInternal(req, res)) return;

  const { channelId, conversationId, message } = req.body ?? {};
  if (!message || typeof message !== 'object') {
    res.status(400).json({ error: 'message is required' });
    return;
  }
  if (conversationId) {
    broadcastChatMessage(String(conversationId), 'conversation', message);
  } else if (channelId) {
    broadcastChatMessage(String(channelId), 'channel', message);
  } else {
    res.status(400).json({ error: 'channelId or conversationId required' });
    return;
  }
  res.json({ ok: true });
});

router.get('/desktop-versions', async (req: Request, res: Response) => {
  if (!verifyInternal(req, res)) return;
  try {
    const { getDesktopVersionStats } = await import('@jibbr/shared-utils');
    const stats = await getDesktopVersionStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load desktop version stats',
    });
  }
});

export default router;
