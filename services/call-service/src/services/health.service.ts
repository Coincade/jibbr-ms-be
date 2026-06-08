import { isTurnConfigured } from '../config/mediasoup.js';
import { getRedisHealth } from '../config/redis.js';
import { getActiveRoomIds } from '../mediasoup/rooms.js';
import { getMediasoupWorkerStats } from '../mediasoup/workers.js';

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
  timestamp: string;
};

export const getCallServiceHealth = (): CallServiceHealth => {
  const workers = getMediasoupWorkerStats();
  const redis = getRedisHealth();
  const activeRooms = getActiveRoomIds().length;

  let status: HealthStatus = 'healthy';

  if (workers.running === 0) {
    status = activeRooms > 0 ? 'unhealthy' : 'degraded';
  } else if (redis.configured && !redis.connected) {
    status = 'degraded';
  }

  return {
    status,
    service: 'call-service',
    uptime: process.uptime(),
    activeRooms,
    mediasoupWorkers: workers,
    redis,
    turnConfigured: isTurnConfigured(),
    announcedIpConfigured: !!process.env.MEDIASOUP_ANNOUNCED_IP?.trim(),
    timestamp: new Date().toISOString(),
  };
};
