import prisma from '../config/database.js';
import { publishChannelMembershipUpdatedEventNow, publishConversationMembershipUpdatedEventNow } from './streams-publisher.service.js';
import { randomUUID } from 'crypto';

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

type OutboxEventType = 'membership.channel.updated' | 'membership.conversation.updated';

type MembershipOutboxPayload = {
  userId: string;
  action: 'add' | 'remove';
  channelId?: string;
  conversationId?: string;
};

const INIT_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS event_outbox (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const INIT_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_event_outbox_status_available
ON event_outbox(status, available_at);
`;

export const initMembershipOutbox = async (): Promise<void> => {
  await prisma.$executeRawUnsafe(INIT_TABLE_SQL);
  await prisma.$executeRawUnsafe(INIT_INDEX_SQL);
};

export const enqueueMembershipOutboxEvent = async (
  tx: TxClient,
  eventType: OutboxEventType,
  payload: MembershipOutboxPayload
): Promise<void> => {
  await tx.$executeRawUnsafe(
    `INSERT INTO event_outbox (id, event_type, payload, status, attempts, available_at, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, 'PENDING', 0, NOW(), NOW(), NOW())`,
    randomUUID(),
    eventType,
    JSON.stringify(payload)
  );
};

const fetchPendingEvents = async (limit = 50) => {
  return prisma.$queryRawUnsafe<
    Array<{
      id: string;
      event_type: OutboxEventType;
      payload: MembershipOutboxPayload;
      attempts: number;
    }>
  >(
    `SELECT id, event_type, payload, attempts
     FROM event_outbox
     WHERE status = 'PENDING' AND available_at <= NOW()
     ORDER BY created_at ASC
     LIMIT $1`,
    limit
  );
};

const markSuccess = async (id: string) => {
  await prisma.$executeRawUnsafe(
    `UPDATE event_outbox SET status='SENT', updated_at=NOW(), last_error=NULL WHERE id=$1`,
    id
  );
};

const markFailure = async (id: string, attempts: number, error: unknown) => {
  const delays = [100, 300, 1000, 3000];
  const delayMs = delays[Math.min(attempts, delays.length - 1)];
  await prisma.$executeRawUnsafe(
    `UPDATE event_outbox
     SET attempts = attempts + 1,
         last_error = $2,
         available_at = NOW() + (($3 || ' milliseconds')::interval),
         updated_at = NOW()
     WHERE id = $1`,
    id,
    error instanceof Error ? error.message : String(error),
    String(delayMs)
  );
};

const publishEventNow = async (eventType: OutboxEventType, payload: MembershipOutboxPayload) => {
  if (eventType === 'membership.channel.updated' && payload.channelId) {
    await publishChannelMembershipUpdatedEventNow({
      userId: payload.userId,
      channelId: payload.channelId,
      action: payload.action,
    });
    return;
  }
  if (eventType === 'membership.conversation.updated' && payload.conversationId) {
    await publishConversationMembershipUpdatedEventNow({
      userId: payload.userId,
      conversationId: payload.conversationId,
      action: payload.action,
    });
  }
};

let relayStarted = false;
export const startMembershipOutboxRelay = () => {
  if (relayStarted) return;
  relayStarted = true;

  const poll = async () => {
    try {
      const events = await fetchPendingEvents();
      for (const event of events) {
        try {
          await publishEventNow(event.event_type, event.payload);
          await markSuccess(event.id);
        } catch (error) {
          await markFailure(event.id, event.attempts, error);
        }
      }
    } catch (error) {
      console.error('[outbox] relay poll failed:', error);
    }
  };

  setInterval(() => {
    void poll();
  }, 1000);
};

export const getMembershipOutboxStats = async () => {
  const [pendingRows, oldestRows] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM event_outbox WHERE status='PENDING'`
    ),
    prisma.$queryRawUnsafe<Array<{ oldest: Date | null }>>(
      `SELECT MIN(created_at) AS oldest FROM event_outbox WHERE status='PENDING'`
    ),
  ]);
  const pendingCount = Number(pendingRows[0]?.count || 0n);
  const oldestPendingAt = oldestRows[0]?.oldest ? new Date(oldestRows[0].oldest).toISOString() : null;
  return { pendingCount, oldestPendingAt };
};

export const cleanupMembershipOutbox = async (): Promise<void> => {
  const retentionDays = Number.parseInt(process.env.MEMBERSHIP_OUTBOX_RETENTION_DAYS || '3', 10);
  await prisma.$executeRawUnsafe(
    `DELETE FROM event_outbox
     WHERE status='SENT' AND created_at < NOW() - (($1 || ' days')::interval)`,
    String(retentionDays)
  );
};

let cleanupStarted = false;
export const startMembershipOutboxCleanup = () => {
  if (cleanupStarted) return;
  cleanupStarted = true;
  const intervalMs = Number.parseInt(process.env.MEMBERSHIP_OUTBOX_CLEANUP_INTERVAL_MS || '3600000', 10);
  setInterval(() => {
    cleanupMembershipOutbox().catch((error) => {
      console.error('[outbox] cleanup failed:', error);
    });
  }, intervalMs);
};

