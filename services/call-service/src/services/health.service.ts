import { isTurnConfigured } from '../config/mediasoup.js';
import { getRedisHealth } from '../config/redis.js';
import { getActiveRoomIds } from '../mediasoup/rooms.js';
import { getMediasoupWorkerStats } from '../mediasoup/workers.js';
import { getCallSignalMetrics } from './call-signal.service.js';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export type CallServiceHealth = {
  status: HealthStatus;
  service: 'call-service';
  uptime: number;
  activeRooms: number;
  mediasoupWorkers: ReturnType<typeof getMediasoupWorkerStats>;
  redis: ReturnType<typeof getRedisHealth>;
  turnConfigured: boolean;
  announcedIpConfigured: boolean;
  /** Soft misconfig hints for operators and clients (does not force unhealthy). */
  warnings: string[];
  callSignal: ReturnType<typeof getCallSignalMetrics>;
  timestamp: string;
};

export const getCallServiceHealth = (): CallServiceHealth => {
  const workers = getMediasoupWorkerStats();
  const redis = getRedisHealth();
  const activeRooms = getActiveRoomIds().length;
  const turnConfigured = isTurnConfigured();
  const announcedIpConfigured = !!process.env.MEDIASOUP_ANNOUNCED_IP?.trim();
  const callSignal = getCallSignalMetrics();

  const warnings: string[] = [];
  if (!turnConfigured) {
    warnings.push(
      'TURN is not configured (set TURN_URL, TURN_USERNAME, TURN_CREDENTIAL). Strict NAT clients may fail.'
    );
  }
  if (!announcedIpConfigured) {
    warnings.push(
      'MEDIASOUP_ANNOUNCED_IP is not set. Clients outside this host may not receive media.'
    );
  }
  if (callSignal.skippedNoConfig > 0) {
    warnings.push(
      'INTERNAL_SERVICE_SECRET / SOCKET_SERVICE_INTERNAL_URL missing — huddle socket fan-out skipped.'
    );
  }
  if (callSignal.failures > 0) {
    warnings.push(
      `call→socket signaling failures: ${callSignal.failures} (see call-signal logs).`
    );
  }

  let status: HealthStatus = 'healthy';

  if (workers.running === 0) {
    status = activeRooms > 0 ? 'unhealthy' : 'degraded';
  } else if (redis.configured && !redis.connected) {
    status = 'degraded';
  } else if (
    process.env.CALL_REQUIRE_NAT_CONFIG === '1' &&
    (!turnConfigured || !announcedIpConfigured)
  ) {
    status = 'degraded';
  } else if (callSignal.failures > 0 && callSignal.successes === 0) {
    status = 'degraded';
  }

  return {
    status,
    service: 'call-service',
    uptime: process.uptime(),
    activeRooms,
    mediasoupWorkers: workers,
    redis,
    turnConfigured,
    announcedIpConfigured,
    warnings,
    callSignal,
    timestamp: new Date().toISOString(),
  };
};
