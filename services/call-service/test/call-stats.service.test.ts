import { beforeEach, describe, expect, it, vi } from 'vitest';

const info = vi.hoisted(() => vi.fn());
const warn = vi.hoisted(() => vi.fn());
const getRoom = vi.hoisted(() => vi.fn());

vi.mock('@jibbr/logger', () => ({
  Logger: class {
    info = info;
    warn = warn;
  },
}));

vi.mock('../src/mediasoup/rooms.js', () => ({
  getRoom,
}));

import { recordCallStatsEvent } from '../src/services/call-stats.service.js';

describe('recordCallStatsEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    getRoom.mockReturnValue({ peers: new Map([['user-1', {}], ['user-2', {}]]) });
  });

  it('logs good quality without a degraded warning', () => {
    recordCallStatsEvent({ userId: 'user-1', roomId: 'room-1', rttMs: 20, packetsLostPct: 0 });

    expect(info).toHaveBeenCalledWith(
      'huddle.stats',
      expect.objectContaining({ quality: 'good', participantCount: 2, roomId: 'room-1' })
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('classifies high loss as bad and throttles the warning', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T10:00:00Z'));

    recordCallStatsEvent({ userId: 'user-1', roomId: 'room-1', packetsLostPct: 12 });
    recordCallStatsEvent({ userId: 'user-1', roomId: 'room-1', packetsLostPct: 12 });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'huddle.stats.degraded',
      expect.objectContaining({ quality: 'bad', userId: 'user-1' })
    );

    vi.setSystemTime(new Date('2026-01-05T10:00:31Z'));
    recordCallStatsEvent({ userId: 'user-1', roomId: 'room-1', packetsLostPct: 12 });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('honors an explicit quality label', () => {
    recordCallStatsEvent({ userId: 'user-1', roomId: 'room-1', callQuality: 'poor', rttMs: 10 });
    expect(info).toHaveBeenCalledWith('huddle.stats', expect.objectContaining({ quality: 'poor' }));
    expect(warn).toHaveBeenCalled();
  });
});
