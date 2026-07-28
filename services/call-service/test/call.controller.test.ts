import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getIceServersMock = vi.hoisted(() => vi.fn(() => [{ urls: 'stun:example.org' }]));
const isTurnConfiguredMock = vi.hoisted(() => vi.fn(() => true));
const getWebRtcTransportOptionsMock = vi.hoisted(() => vi.fn(() => ({ listenIps: [{ ip: '0.0.0.0' }] })));

const getOrCreatePeerMock = vi.hoisted(() => vi.fn());
const getOrCreateRoomMock = vi.hoisted(() => vi.fn());
const getRoomMock = vi.hoisted(() => vi.fn());
const listOtherParticipantsMock = vi.hoisted(() => vi.fn(() => []));
const listRemoteProducersMock = vi.hoisted(() => vi.fn(() => []));
const removePeerMock = vi.hoisted(() => vi.fn());
const getRoomSnapshotMock = vi.hoisted(() => vi.fn());
const forceCloseRoomMock = vi.hoisted(() => vi.fn());
const setPeerMediaStateMock = vi.hoisted(() => vi.fn());
const findProducerInRoomMock = vi.hoisted(() => vi.fn());

const emitProducerClosedMock = vi.hoisted(() => vi.fn());
const emitWorkspaceHuddleUpdateMock = vi.hoisted(() => vi.fn());
const assertRoomMemberMock = vi.hoisted(() => vi.fn());
const startHuddleSessionRecordMock = vi.hoisted(() => vi.fn());
const listRecentHuddlesMock = vi.hoisted(() => vi.fn());
const listChannelHuddleHistoryMock = vi.hoisted(() => vi.fn());
const listLiveHuddlesForWorkspaceMock = vi.hoisted(() => vi.fn());
const buildWorkspaceHuddlePayloadMock = vi.hoisted(() => vi.fn(() => ({ ok: true })));
const resolveWorkspaceIdForRoomMock = vi.hoisted(() => vi.fn());
const recordCallStatsEventMock = vi.hoisted(() => vi.fn());
const producerSourceFromProducerMock = vi.hoisted(() => vi.fn(() => 'screen'));

vi.mock('../src/config/mediasoup.js', () => ({
  getIceServers: getIceServersMock,
  getWebRtcTransportOptions: getWebRtcTransportOptionsMock,
  isTurnConfigured: isTurnConfiguredMock,
}));

vi.mock('../src/mediasoup/rooms.js', () => ({
  getOrCreatePeer: getOrCreatePeerMock,
  getOrCreateRoom: getOrCreateRoomMock,
  getRoom: getRoomMock,
  listOtherParticipants: listOtherParticipantsMock,
  listRemoteProducers: listRemoteProducersMock,
  removePeer: removePeerMock,
  getRoomSnapshot: getRoomSnapshotMock,
  forceCloseRoom: forceCloseRoomMock,
  setPeerMediaState: setPeerMediaStateMock,
  findProducerInRoom: findProducerInRoomMock,
}));

vi.mock('../src/mediasoup/producer-source.js', () => ({
  producerSourceFromProducer: producerSourceFromProducerMock,
}));

vi.mock('../src/services/call-signal.service.js', () => ({
  emitProducerClosed: emitProducerClosedMock,
  emitWorkspaceHuddleUpdate: emitWorkspaceHuddleUpdateMock,
}));

vi.mock('../src/services/membership.service.js', () => ({
  assertRoomMember: assertRoomMemberMock,
}));

vi.mock('../src/services/huddle-session.service.js', () => ({
  startHuddleSessionRecord: startHuddleSessionRecordMock,
  listRecentHuddles: listRecentHuddlesMock,
  listChannelHuddleHistory: listChannelHuddleHistoryMock,
}));

vi.mock('../src/services/huddle-live.service.js', () => ({
  listLiveHuddlesForWorkspace: listLiveHuddlesForWorkspaceMock,
  buildWorkspaceHuddlePayload: buildWorkspaceHuddlePayloadMock,
  resolveWorkspaceIdForRoom: resolveWorkspaceIdForRoomMock,
}));

vi.mock('../src/services/call-stats.service.js', () => ({
  recordCallStatsEvent: recordCallStatsEventMock,
}));

function createRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

const ORIGINAL_ENV = { ...process.env };

describe('call.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('joinChannelCall rejects when the huddle is already full', async () => {
    process.env.MAX_HUDDLE_PARTICIPANTS = '2';
    const room = {
      sessionId: 'sess-1',
      hostUserId: 'host-1',
      peers: new Map([
        ['u1', {}],
        ['u2', {}],
      ]),
      router: { rtpCapabilities: { codecs: [] } },
    };
    getRoomMock.mockReturnValue(room);

    const req: any = {
      params: { channelId: 'room-1' },
      user: { id: 'user-3', name: 'Asha' },
    };
    const res = createRes();

    await import('../src/controllers/call.controller.js').then((m) => m.joinChannelCall(req, res));

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'huddle_full' })
    );
    expect(getOrCreatePeerMock).not.toHaveBeenCalled();
  });

  it('endChannelCall rejects non-host users', async () => {
    getRoomMock.mockReturnValue({ hostUserId: 'host-1' });
    const req: any = {
      params: { channelId: 'room-1' },
      user: { id: 'user-2' },
    };
    const res = createRes();

    await import('../src/controllers/call.controller.js').then((m) => m.endChannelCall(req, res));

    expect(assertRoomMemberMock).toHaveBeenCalledWith('user-2', 'room-1');
    expect(res.status).toHaveBeenCalledWith(403);
    expect(forceCloseRoomMock).not.toHaveBeenCalled();
  });

  it('createWebRtcTransport returns 404 when no room is active', async () => {
    getRoomMock.mockReturnValue(undefined);
    const req: any = {
      body: { channelId: 'room-1', direction: 'send' },
      user: { id: 'user-1' },
    };
    const res = createRes();

    await import('../src/controllers/call.controller.js').then((m) => m.createWebRtcTransport(req, res));

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'No active call in this room' });
  });

  it('produce returns 404 when the send transport does not match the request', async () => {
    getRoomMock.mockReturnValue({
      peers: new Map([['user-1', { sendTransport: { id: 'other-transport' } }]]),
    });
    const req: any = {
      body: {
        channelId: 'room-1',
        transportId: 'transport-1',
        kind: 'video',
        rtpParameters: {},
      },
      user: { id: 'user-1' },
    };
    const res = createRes();

    await import('../src/controllers/call.controller.js').then((m) => m.produce(req, res));

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Send transport not found' });
  });

  it('consume returns 400 when the router cannot consume the producer', async () => {
    getRoomMock.mockReturnValue({
      router: { canConsume: vi.fn(() => false) },
    });
    const req: any = {
      body: {
        channelId: 'room-1',
        transportId: 'transport-1',
        producerId: 'producer-1',
        rtpCapabilities: {},
      },
      user: { id: 'user-1' },
    };
    const res = createRes();

    await import('../src/controllers/call.controller.js').then((m) => m.consume(req, res));

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Cannot consume producer' });
  });
});
