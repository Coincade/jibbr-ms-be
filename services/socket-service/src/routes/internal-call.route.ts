import { Router, type Request, type Response } from 'express';
import {
  broadcastToChannel,
  broadcastToConversation,
  broadcastWorkspaceHuddleUpdate,
  broadcastChatMessage,
} from '../websocket/index.js';

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

router.post('/call/broadcast-workspace', (req: Request, res: Response) => {
  if (!verifyInternal(req, res)) return;

  const { workspaceId, event, data } = req.body ?? {};
  if (!workspaceId) {
    res.status(400).json({ error: 'workspaceId is required' });
    return;
  }
  const eventName =
    typeof event === 'string' && event.length > 0 ? event : 'workspace_huddle_updated';
  broadcastWorkspaceHuddleUpdate(String(workspaceId), eventName, data ?? {});
  res.json({ ok: true });
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

export default router;
