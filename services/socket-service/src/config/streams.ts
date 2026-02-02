export const STREAMS = {
  MESSAGES: 'messages',
  NOTIFICATIONS: 'notifications',
  USER_EVENTS: 'user-events',
  WORKSPACE_EVENTS: 'workspace-events',
  CHANNEL_EVENTS: 'channel-events',
} as const;

export const STREAMS_GROUP = process.env.STREAMS_GROUP || 'socket-service-group';
export const STREAMS_CONSUMER =
  process.env.STREAMS_CONSUMER || `socket-${process.pid}`;

export const STREAMS_DEDUPE_TTL_SECONDS = Number(
  process.env.STREAMS_DEDUPE_TTL_SECONDS || 86400
);
export const STREAMS_CLAIM_IDLE_MS = Number(
  process.env.STREAMS_CLAIM_IDLE_MS || 60000
);
export const STREAMS_READ_COUNT = Number(
  process.env.STREAMS_READ_COUNT || 20
);
export const STREAMS_BLOCK_MS = Number(process.env.STREAMS_BLOCK_MS || 5000);
