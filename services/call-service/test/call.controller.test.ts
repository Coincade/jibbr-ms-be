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
const assertWorkspaceMemberMock = vi.hoisted(() => vi.fn());
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
  assertWorkspaceMember: assertWorkspaceMemberMock,
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
    assertRoomMemberMock.mockResolvedValue(undefined);
    assertWorkspaceMemberMock.mockResolvedValue(undefined);
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
    assertRoomMemberMock.mockResolvedValue(undefined);
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

    expect(assertRoomMemberMock).toHaveBeenCalledWith('user-1', 'room-1');
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Send transport not found' });
  });

  it('produce returns 403 when membership is revoked mid-call', async () => {
    assertRoomMemberMock.mockRejectedValue(new Error('You are not a member of this channel'));
    const req: any = {
      body: {
        channelId: 'room-1',
        transportId: 'transport-1',
        kind: 'audio',
        rtpParameters: {},
      },
      user: { id: 'user-1' },
    };
    const res = createRes();

    await import('../src/controllers/call.controller.js').then((m) => m.produce(req, res));

    expect(res.status).toHaveBeenCalledWith(403);
    expect(getRoomMock).not.toHaveBeenCalled();
  });

  it('getChannelCall returns 403 for non-members', async () => {
    assertRoomMemberMock.mockRejectedValue(new Error('You are not a member of this channel'));
    const req: any = {
      params: { channelId: 'room-1' },
      user: { id: 'user-1' },
    };
    const res = createRes();

    await import('../src/controllers/call.controller.js').then((m) => m.getChannelCall(req, res));

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('leaveChannelCall returns 403 for non-members', async () => {
    assertRoomMemberMock.mockRejectedValue(new Error('You are not a member of this channel'));
    const req: any = {
      params: { channelId: 'room-1' },
      user: { id: 'user-1' },
    };
    const res = createRes();

    await import('../src/controllers/call.controller.js').then((m) => m.leaveChannelCall(req, res));

    expect(res.status).toHaveBeenCalledWith(403);
    expect(removePeerMock).not.toHaveBeenCalled();
  });

  it('consume returns 400 when the router cannot consume the producer', async () => {
    assertRoomMemberMock.mockResolvedValue(undefined);
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

    expect(assertRoomMemberMock).toHaveBeenCalledWith('user-1', 'room-1');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Cannot consume producer' });
  });

  it('joinConversationCall uses the conversation room id', async () => {
    getRoomMock.mockReturnValue(undefined);
    getOrCreateRoomMock.mockResolvedValue({
      sessionId: 'sess-1',
      hostUserId: 'user-1',
      peers: new Map(),
      router: { rtpCapabilities: { codecs: [] } },
    });
    getOrCreatePeerMock.mockReturnValue({ id: 'user-1' });
    const req: any = { params: { conversationId: 'cv-1' }, user: { id: 'user-1', name: 'Asha' } };
    const res = createRes();

    await import('../src/controllers/call.controller.js').then((m) => m.joinConversationCall(req, res));

    expect(assertRoomMemberMock).toHaveBeenCalledWith('user-1', 'conv:cv-1');
    expect(getOrCreateRoomMock).toHaveBeenCalledWith('conv:cv-1', expect.any(Object));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ roomId: 'conv:cv-1' }));
  });

  it('leaveConversationCall removes the peer from the conversation room', async () => {
    removePeerMock.mockResolvedValue({ roomEmptied: true });
    const req: any = { params: { conversationId: 'cv-1' }, user: { id: 'user-1' } };
    const res = createRes();

    await import('../src/controllers/call.controller.js').then((m) => m.leaveConversationCall(req, res));

    expect(assertRoomMemberMock).toHaveBeenCalledWith('user-1', 'conv:cv-1');
    expect(removePeerMock).toHaveBeenCalledWith('conv:cv-1', 'user-1');
    expect(res.json).toHaveBeenCalledWith({ ok: true, roomEmptied: true });
  });

  it('getConversationCall reports an inactive room', async () => {
    getRoomSnapshotMock.mockReturnValue(undefined);
    const req: any = { params: { conversationId: 'cv-1' }, user: { id: 'user-1' } };
    const res = createRes();

    await import('../src/controllers/call.controller.js').then((m) => m.getConversationCall(req, res));

    expect(res.json).toHaveBeenCalledWith({ active: false, roomId: 'conv:cv-1' });
  });

  it('endConversationCall lets the host close the room', async () => {
    getRoomMock.mockReturnValue({ hostUserId: 'user-1' });
    const req: any = { params: { conversationId: 'cv-1' }, user: { id: 'user-1' } };
    const res = createRes();

    await import('../src/controllers/call.controller.js').then((m) => m.endConversationCall(req, res));

    expect(forceCloseRoomMock).toHaveBeenCalledWith('conv:cv-1');
    expect(res.json).toHaveBeenCalledWith({ ok: true, ended: true, roomEmptied: true });
  });

  it('endConversationCall rejects a non-host', async () => {
    getRoomMock.mockReturnValue({ hostUserId: 'host-1' });
    const req: any = { params: { conversationId: 'cv-1' }, user: { id: 'user-2' } };
    const res = createRes();

    await import('../src/controllers/call.controller.js').then((m) => m.endConversationCall(req, res));

    expect(res.status).toHaveBeenCalledWith(403);
    expect(forceCloseRoomMock).not.toHaveBeenCalled();
  });

  it('updateCallMediaState returns the updated peer flags', async () => {
    setPeerMediaStateMock.mockReturnValue({ audioMuted: true, videoMuted: false, raisedHand: true });
    const req: any = {
      user: { id: 'user-1' },
      body: { channelId: 'room-1', audioMuted: true, videoMuted: false, raisedHand: true },
    };
    const res = createRes();

    await import('../src/controllers/call.controller.js').then((m) => m.updateCallMediaState(req, res));

    expect(res.json).toHaveBeenCalledWith({
      userId: 'user-1',
      audioMuted: true,
      videoMuted: false,
      raisedHand: true,
    });
  });

  it('updateCallMediaState returns 404 when the peer is not in the call', async () => {
    setPeerMediaStateMock.mockReturnValue(undefined);
    const req: any = { user: { id: 'user-1' }, body: { channelId: 'room-1', audioMuted: true } };
    const res = createRes();

    await import('../src/controllers/call.controller.js').then((m) => m.updateCallMediaState(req, res));

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Peer not in call' });
  });

  it('listWorkspaceHuddleHistory returns sessions for a member', async () => {
    listRecentHuddlesMock.mockResolvedValue([{ id: 'h1' }]);
    const req: any = { user: { id: 'user-1' }, params: { workspaceId: 'w1' }, query: {} };
    const res = createRes();

    await import('../src/controllers/call.controller.js').then((m) => m.listWorkspaceHuddleHistory(req, res));

    expect(assertWorkspaceMemberMock).toHaveBeenCalledWith('user-1', 'w1');
    expect(res.json).toHaveBeenCalledWith({ sessions: [{ id: 'h1' }] });
  });

  it('listWorkspaceHuddleHistory returns 403 when the user is not a member', async () => {
    assertWorkspaceMemberMock.mockRejectedValue(new Error('You are not a member of this workspace'));
    const req: any = { user: { id: 'user-1' }, params: { workspaceId: 'w1' }, query: {} };
    const res = createRes();

    await import('../src/controllers/call.controller.js').then((m) => m.listWorkspaceHuddleHistory(req, res));

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('listWorkspaceHuddlesLive returns the live huddle list', async () => {
    listLiveHuddlesForWorkspaceMock.mockResolvedValue([{ roomId: 'room-1' }]);
    const req: any = { user: { id: 'user-1' }, params: { workspaceId: 'w1' } };
    const res = createRes();

    await import('../src/controllers/call.controller.js').then((m) => m.listWorkspaceHuddlesLive(req, res));

    expect(listLiveHuddlesForWorkspaceMock).toHaveBeenCalledWith('w1', 'user-1');
    expect(res.json).toHaveBeenCalledWith({ huddles: [{ roomId: 'room-1' }] });
  });

  it('listChannelHuddlesHistory returns sessions for a channel member', async () => {
    listChannelHuddleHistoryMock.mockResolvedValue([{ id: 'h1' }]);
    const req: any = { user: { id: 'user-1' }, params: { channelId: 'room-1' }, query: { limit: '10' } };
    const res = createRes();

    await import('../src/controllers/call.controller.js').then((m) => m.listChannelHuddlesHistory(req, res));

    expect(listChannelHuddleHistoryMock).toHaveBeenCalledWith('room-1', 10);
    expect(res.json).toHaveBeenCalledWith({ sessions: [{ id: 'h1' }] });
  });

  it('connectWebRtcTransport connects the matching send transport', async () => {
    const connect = vi.fn();
    getRoomMock.mockReturnValue({
      peers: new Map([['user-1', { sendTransport: { id: 't1', connect }, recvTransport: undefined }]]),
    });
    const req: any = {
      user: { id: 'user-1' },
      params: { transportId: 't1' },
      body: { channelId: 'room-1', dtlsParameters: { fingerprints: [] } },
    };
    const res = createRes();

    await import('../src/controllers/call.controller.js').then((m) => m.connectWebRtcTransport(req, res));

    expect(connect).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ connected: true });
  });

  it('connectWebRtcTransport returns 404 when the transport is missing', async () => {
    getRoomMock.mockReturnValue({
      peers: new Map([['user-1', { sendTransport: { id: 'other' } }]]),
    });
    const req: any = {
      user: { id: 'user-1' },
      params: { transportId: 't1' },
      body: { channelId: 'room-1', dtlsParameters: {} },
    };
    const res = createRes();

    await import('../src/controllers/call.controller.js').then((m) => m.connectWebRtcTransport(req, res));

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Transport not found' });
  });

  it('resumeConsumer resumes the consumer', async () => {
    const resume = vi.fn();
    getRoomMock.mockReturnValue({
      peers: new Map([['user-1', { consumers: new Map([['c1', { resume }]]) }]]),
    });
    const req: any = { user: { id: 'user-1' }, params: { consumerId: 'c1' }, body: { channelId: 'room-1' } };
    const res = createRes();

    await import('../src/controllers/call.controller.js').then((m) => m.resumeConsumer(req, res));

    expect(resume).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ resumed: true });
  });

  it('pauseProducer and resumeProducer toggle the producer', async () => {
    const pause = vi.fn();
    const resume = vi.fn();
    getRoomMock.mockReturnValue({
      peers: new Map([['user-1', { producers: new Map([['p1', { pause, resume }]]) }]]),
    });
    const req: any = { user: { id: 'user-1' }, params: { producerId: 'p1' }, body: { channelId: 'room-1' } };
    const pauseRes = createRes();
    const resumeRes = createRes();
    const controller = await import('../src/controllers/call.controller.js');

    await controller.pauseProducer(req, pauseRes);
    await controller.resumeProducer(req, resumeRes);

    expect(pause).toHaveBeenCalled();
    expect(resume).toHaveBeenCalled();
    expect(pauseRes.json).toHaveBeenCalledWith({ paused: true });
    expect(resumeRes.json).toHaveBeenCalledWith({ resumed: true });
  });

  it('pauseProducer returns 404 when the producer is missing', async () => {
    getRoomMock.mockReturnValue({ peers: new Map([['user-1', { producers: new Map() }]]) });
    const req: any = { user: { id: 'user-1' }, params: { producerId: 'p1' }, body: { channelId: 'room-1' } };
    const res = createRes();

    await import('../src/controllers/call.controller.js').then((m) => m.pauseProducer(req, res));

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Producer not found' });
  });

  it('setConsumerLayers stores the preferred layers', async () => {
    const setPreferredLayers = vi.fn();
    getRoomMock.mockReturnValue({
      peers: new Map([['user-1', { consumers: new Map([['c1', { setPreferredLayers }]]) }]]),
    });
    const req: any = {
      user: { id: 'user-1' },
      params: { consumerId: 'c1' },
      body: { channelId: 'room-1', spatialLayer: 1, temporalLayer: 2 },
    };
    const res = createRes();

    await import('../src/controllers/call.controller.js').then((m) => m.setConsumerLayers(req, res));

    expect(setPreferredLayers).toHaveBeenCalledWith({ spatialLayer: 1, temporalLayer: 2 });
    expect(res.json).toHaveBeenCalledWith({ ok: true, spatialLayer: 1 });
  });

  it('recordCallStats stores the sample and rejects a payload without a room', async () => {
    const okReq: any = { user: { id: 'user-1' }, body: { channelId: 'room-1', rttMs: 40, callQuality: 'good' } };
    const okRes = createRes();
    const badReq: any = { user: { id: 'user-1' }, body: {} };
    const badRes = createRes();
    const controller = await import('../src/controllers/call.controller.js');

    await controller.recordCallStats(okReq, okRes);
    await controller.recordCallStats(badReq, badRes);

    expect(recordCallStatsEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', roomId: 'room-1', callQuality: 'good' })
    );
    expect(okRes.json).toHaveBeenCalledWith({ ok: true });
    expect(badRes.status).toHaveBeenCalledWith(400);
  });
});
