import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const broadcastToChannelMock = vi.hoisted(() => vi.fn());
const broadcastToConversationMock = vi.hoisted(() => vi.fn());
const broadcastWorkspaceHuddleUpdateMock = vi.hoisted(() => vi.fn());
const broadcastChatMessageMock = vi.hoisted(() => vi.fn());

vi.mock('../src/websocket/index.js', () => ({
  broadcastToChannel: broadcastToChannelMock,
  broadcastToConversation: broadcastToConversationMock,
  broadcastWorkspaceHuddleUpdate: broadcastWorkspaceHuddleUpdateMock,
  broadcastChatMessage: broadcastChatMessageMock,
}));

const ORIGINAL_ENV = { ...process.env };

describe('internal call route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, INTERNAL_SERVICE_SECRET: 'secret-1' };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  async function createApp() {
    const router = (await import('../src/routes/internal-call.route.js')).default;
    const app = express();
    app.use(express.json());
    app.use('/internal', router);
    return app;
  }

  it('rejects requests with the wrong internal secret', async () => {
    const app = await createApp();

    const res = await request(app)
      .post('/internal/call/broadcast')
      .set('X-Internal-Secret', 'wrong')
      .send({ channelId: 'ch-1', event: 'channel_call_started', data: {} });

    expect(res.status).toBe(401);
    expect(broadcastToChannelMock).not.toHaveBeenCalled();
  });

  it('broadcasts conversation call events to conversation rooms', async () => {
    const app = await createApp();

    const res = await request(app)
      .post('/internal/call/broadcast')
      .set('X-Internal-Secret', 'secret-1')
      .send({ conversationId: 'dm-1', event: 'conversation_call_started', data: { foo: 'bar' } });

    expect(res.status).toBe(200);
    expect(broadcastToConversationMock).toHaveBeenCalledWith(
      'dm-1',
      'conversation_call_started',
      expect.objectContaining({ foo: 'bar', conversationId: 'dm-1' })
    );
  });

  it('requires workspaceId for workspace broadcasts', async () => {
    const app = await createApp();

    const res = await request(app)
      .post('/internal/call/broadcast-workspace')
      .set('X-Internal-Secret', 'secret-1')
      .send({ data: {} });

    expect(res.status).toBe(400);
    expect(broadcastWorkspaceHuddleUpdateMock).not.toHaveBeenCalled();
  });
});
