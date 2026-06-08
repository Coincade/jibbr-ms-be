import { Logger } from '@jibbr/logger';
import { getRoom } from '../mediasoup/rooms.js';

const logger = new Logger('call-service');

export type CallQualityLabel = 'good' | 'poor' | 'bad';

export type CallStatsPayload = {
  userId: string;
  roomId: string;
  rttMs?: number | null;
  packetsLostPct?: number;
  outboundBitrateKbps?: number;
  callQuality?: CallQualityLabel;
};

const classifyQuality = (payload: CallStatsPayload): CallQualityLabel => {
  if (payload.callQuality) return payload.callQuality;
  const loss = payload.packetsLostPct ?? 0;
  const rtt = payload.rttMs;
  if (loss > 10 || (rtt != null && rtt > 400)) return 'bad';
  if (loss > 3 || (rtt != null && rtt > 200)) return 'poor';
  return 'good';
};

/** Throttle poor/bad quality warnings — one per user+room per interval. */
const WARN_THROTTLE_MS = 30_000;
const lastWarnAt = new Map<string, number>();

const warnKey = (userId: string, roomId: string) => `${userId}:${roomId}`;

export const recordCallStatsEvent = (payload: CallStatsPayload): void => {
  const quality = classifyQuality(payload);
  const room = getRoom(payload.roomId);
  const participantCount = room?.peers.size ?? null;

  logger.info('huddle.stats', {
    event: 'huddle.stats',
    userId: payload.userId,
    roomId: payload.roomId,
    rttMs: payload.rttMs ?? null,
    packetsLostPct: payload.packetsLostPct ?? 0,
    outboundBitrateKbps: payload.outboundBitrateKbps ?? 0,
    quality,
    participantCount,
  });

  if (quality === 'good') return;

  const key = warnKey(payload.userId, payload.roomId);
  const now = Date.now();
  const last = lastWarnAt.get(key) ?? 0;
  if (now - last < WARN_THROTTLE_MS) return;
  lastWarnAt.set(key, now);

  logger.warn('huddle.stats.degraded', {
    event: 'huddle.stats.degraded',
    userId: payload.userId,
    roomId: payload.roomId,
    quality,
    rttMs: payload.rttMs ?? null,
    packetsLostPct: payload.packetsLostPct ?? 0,
    outboundBitrateKbps: payload.outboundBitrateKbps ?? 0,
    participantCount,
  });
};
