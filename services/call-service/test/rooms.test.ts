import { afterEach, describe, expect, it, vi } from 'vitest';

const getNextWorkerMock = vi.fn();
const setOnWorkerDiedMock = vi.fn();
const trackRoomOnWorkerMock = vi.fn();
const untrackRoomOnWorkerMock = vi.fn();
const persistRoomMock = vi.fn();
const deletePersistedRoomMock = vi.fn();
const getPersistedRoomMock = vi.fn();
const endHuddleSessionRecordMock = vi.fn();
const createHuddleEndedMessageMock = vi.fn();
const resolveWorkspaceIdForRoomMock = vi.fn();
const buildWorkspaceHuddlePayloadMock = vi.fn();
const buildWorkspaceHuddleInactivePayloadMock = vi.fn();
const emitWorkspaceHuddleUpdateMock = vi.fn();

vi.mock('../src/mediasoup/workers.js', () => ({
  getNextWorker: getNextWorkerMock,
  setOnWorkerDied: setOnWorkerDiedMock,
  trackRoomOnWorker: trackRoomOnWorkerMock,
  untrackRoomOnWorker: untrackRoomOnWorkerMock,
}));

vi.mock('../src/mediasoup/rooms-redis.js', () => ({
  persistRoom: persistRoomMock,
  deletePersistedRoom: deletePersistedRoomMock,
  getPersistedRoom: getPersistedRoomMock,
}));

vi.mock('../src/services/huddle-session.service.js', () => ({
  endHuddleSessionRecord: endHuddleSessionRecordMock,
}));

vi.mock('../src/services/huddle-ended-message.service.js', () => ({
  createHuddleEndedMessage: createHuddleEndedMessageMock,
}));

vi.mock('../src/services/huddle-live.service.js', () => ({
  buildWorkspaceHuddleInactivePayload: buildWorkspaceHuddleInactivePayloadMock,
  buildWorkspaceHuddlePayload: buildWorkspaceHuddlePayloadMock,
  resolveWorkspaceIdForRoom: resolveWorkspaceIdForRoomMock,
}));

vi.mock('../src/services/call-signal.service.js', () => ({
  emitWorkspaceHuddleUpdate: emitWorkspaceHuddleUpdateMock,
}));

const makeRouter = () => ({
  close: vi.fn(),
});

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('rooms', () => {
  it('creates a room, assigns the first peer as host, and updates peer media state', async () => {
    const router = makeRouter();
    getPersistedRoomMock.mockResolvedValue(null);
    getNextWorkerMock.mockReturnValue({
      pid: 321,
      createRouter: vi.fn().mockResolvedValue(router),
    });

    const rooms = await import('../src/mediasoup/rooms.js');
    const room = await rooms.getOrCreateRoom('room-1');
    rooms.getOrCreatePeer(room, 'user-1', 'Alice');
    rooms.setPeerMediaState('room-1', 'user-1', { audioMuted: true, videoMuted: false });

    const snapshot = rooms.getRoomSnapshot('room-1');

    expect(trackRoomOnWorkerMock).toHaveBeenCalledWith(321);
    expect(room.hostUserId).toBe('user-1');
    expect(snapshot).toMatchObject({
      roomId: 'room-1',
      hostUserId: 'user-1',
      participantCount: 1,
      participants: [
        {
          userId: 'user-1',
          displayName: 'Alice',
          audioMuted: true,
          videoMuted: false,
          producerIds: [],
          producers: [],
        },
      ],
    });
    expect(persistRoomMock).toHaveBeenCalled();
  });

  it('transfers host to remaining peer when host leaves', async () => {
    const router = makeRouter();
    getPersistedRoomMock.mockResolvedValue(null);
    getNextWorkerMock.mockReturnValue({
      pid: 777,
      createRouter: vi.fn().mockResolvedValue(router),
    });

    const rooms = await import('../src/mediasoup/rooms.js');
    const room = await rooms.getOrCreateRoom('room-host-xfer');
    rooms.getOrCreatePeer(room, 'host', 'Host');
    rooms.getOrCreatePeer(room, 'guest', 'Guest');
    expect(room.hostUserId).toBe('host');

    const result = await rooms.removePeer('room-host-xfer', 'host');
    expect(result).toEqual({ roomEmptied: false });
    expect(room.hostUserId).toBe('guest');
  });

  it('closes the room when the last peer leaves and cleans up room resources', async () => {
    const router = makeRouter();
    const sendTransport = { close: vi.fn() };
    const recvTransport = { close: vi.fn() };
    const audioProducer = { close: vi.fn(), id: 'prod-1', kind: 'audio' };
    const videoConsumer = { close: vi.fn(), id: 'cons-1' };

    getPersistedRoomMock.mockResolvedValue(null);
    getNextWorkerMock.mockReturnValue({
      pid: 654,
      createRouter: vi.fn().mockResolvedValue(router),
    });
    endHuddleSessionRecordMock.mockResolvedValue(0);
    resolveWorkspaceIdForRoomMock.mockResolvedValue('ws-1');
    buildWorkspaceHuddleInactivePayloadMock.mockReturnValue({
      workspaceId: 'ws-1',
      roomId: 'room-2',
      active: false,
    });

    const rooms = await import('../src/mediasoup/rooms.js');
    const room = await rooms.getOrCreateRoom('room-2');
    const peer = rooms.getOrCreatePeer(room, 'user-2', 'Bob');
    peer.sendTransport = sendTransport as any;
    peer.recvTransport = recvTransport as any;
    peer.producers.set('prod-1', audioProducer as any);
    peer.consumers.set('cons-1', videoConsumer as any);

    const result = await rooms.removePeer('room-2', 'user-2');

    expect(result).toEqual({ roomEmptied: true });
    expect(audioProducer.close).toHaveBeenCalled();
    expect(videoConsumer.close).toHaveBeenCalled();
    expect(sendTransport.close).toHaveBeenCalled();
    expect(recvTransport.close).toHaveBeenCalled();
    expect(router.close).toHaveBeenCalled();
    expect(untrackRoomOnWorkerMock).toHaveBeenCalledWith(654);
    expect(deletePersistedRoomMock).toHaveBeenCalledWith('room-2');
    expect(rooms.getRoom('room-2')).toBeUndefined();
    expect(createHuddleEndedMessageMock).not.toHaveBeenCalled();
    // Presence must clear even when no DB session row was ended.
    expect(emitWorkspaceHuddleUpdateMock).toHaveBeenCalledWith(
      'ws-1',
      expect.objectContaining({ active: false, roomId: 'room-2' })
    );
  });
});
