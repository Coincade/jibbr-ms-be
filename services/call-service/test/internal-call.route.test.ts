import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const removePeerMock = vi.hoisted(() => vi.fn());
const getRoomSnapshotMock = vi.hoisted(() => vi.fn());

vi.mock('../src/mediasoup/rooms.js', () => ({
  removePeer: removePeerMock,
  getRoomSnapshot: getRoomSnapshotMock,
}));

const ORIGINAL_ENV = { ...process.env };

function createRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('internal-call.route kick-peer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, INTERNAL_SERVICE_SECRET: 'secret-1' };
    removePeerMock.mockResolvedValue({ roomEmptied: false });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('rejects missing internal secret', async () => {
    const { kickPeerInternal } = await import('../src/routes/internal-call.route.js');
    const req: any = {
      header: () => 'wrong',
      body: { userId: 'u1', channelId: 'ch-1' },
    };
    const res = createRes();
    await kickPeerInternal(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(removePeerMock).not.toHaveBeenCalled();
  });

  it('kicks a channel peer from the SFU room', async () => {
    const { kickPeerInternal } = await import('../src/routes/internal-call.route.js');
    const req: any = {
      header: (name: string) => (name === 'X-Internal-Secret' ? 'secret-1' : undefined),
      body: { userId: 'u1', channelId: 'ch-1' },
    };
    const res = createRes();
    await kickPeerInternal(req, res);
    expect(removePeerMock).toHaveBeenCalledWith('ch-1', 'u1');
    expect(res.json).toHaveBeenCalledWith({ ok: true, roomEmptied: false });
  });

  it('resolves conversation room ids', async () => {
    const { kickPeerInternal } = await import('../src/routes/internal-call.route.js');
    const req: any = {
      header: (name: string) => (name === 'X-Internal-Secret' ? 'secret-1' : undefined),
      body: { userId: 'u1', conversationId: 'conv-1' },
    };
    const res = createRes();
    await kickPeerInternal(req, res);
    expect(removePeerMock).toHaveBeenCalledWith('conv:conv-1', 'u1');
  });
});

describe('internal-call.route host-check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, INTERNAL_SERVICE_SECRET: 'secret-1' };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('reports inactive when the room does not exist', async () => {
    getRoomSnapshotMock.mockReturnValue(null);
    const { hostCheckInternal } = await import('../src/routes/internal-call.route.js');
    const req: any = {
      header: (name: string) => (name === 'X-Internal-Secret' ? 'secret-1' : undefined),
      body: { userId: 'u1', channelId: 'ch-1' },
    };
    const res = createRes();
    await hostCheckInternal(req, res);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      active: false,
      hostUserId: null,
      isHost: false,
      participantCount: 0,
    });
  });

  it('reports isHost true for the current host of an active room', async () => {
    getRoomSnapshotMock.mockReturnValue({
      hostUserId: 'host-1',
      participantCount: 3,
    });
    const { hostCheckInternal } = await import('../src/routes/internal-call.route.js');
    const req: any = {
      header: (name: string) => (name === 'X-Internal-Secret' ? 'secret-1' : undefined),
      body: { userId: 'host-1', channelId: 'ch-1' },
    };
    const res = createRes();
    await hostCheckInternal(req, res);
    expect(getRoomSnapshotMock).toHaveBeenCalledWith('ch-1');
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      active: true,
      hostUserId: 'host-1',
      isHost: true,
      participantCount: 3,
    });
  });

  it('reports isHost false for a non-host peer', async () => {
    getRoomSnapshotMock.mockReturnValue({
      hostUserId: 'host-1',
      participantCount: 2,
    });
    const { hostCheckInternal } = await import('../src/routes/internal-call.route.js');
    const req: any = {
      header: (name: string) => (name === 'X-Internal-Secret' ? 'secret-1' : undefined),
      body: { userId: 'peer-2', conversationId: 'dm-1' },
    };
    const res = createRes();
    await hostCheckInternal(req, res);
    expect(getRoomSnapshotMock).toHaveBeenCalledWith('conv:dm-1');
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      active: true,
      hostUserId: 'host-1',
      isHost: false,
      participantCount: 2,
    });
  });
});
