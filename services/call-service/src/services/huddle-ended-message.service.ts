import prisma from '../config/database.js';
import type { Room } from '../mediasoup/rooms.js';
import { conversationIdFromRoom } from '../utils/room-id.js';
import { formatHuddleEndedContent } from '../utils/huddle-message.js';
import { emitChatMessage } from './call-signal.service.js';

export const createHuddleEndedMessage = async (
  roomId: string,
  room: Room,
  peakCount: number
): Promise<void> => {
  try {
    const conversationId = conversationIdFromRoom(roomId);
    const channelId = conversationId ? null : roomId;

    // Important: closeRoom can be called concurrently.
    // We intentionally do *not* query for open sessions here; closeRoom will lock via `endedAt` update.
    const startedAt = room.createdAt;
    const startedById = room.hostUserId;
    if (!startedById) return;

    const durationMs = Math.max(0, Date.now() - startedAt.getTime());
    const durationMinutes = Math.max(1, Math.round(durationMs / 60_000));
    const peak = Math.max(peakCount, room.peakParticipantCount, 1);

    const payload = { durationMinutes, peakCount: peak };
    const content = formatHuddleEndedContent(payload);

    const message = await prisma.message.create({
      data: {
        content,
        channelId: channelId ?? undefined,
        conversationId: conversationId ?? undefined,
        userId: startedById,
      },
      include: {
        user: { select: { id: true, name: true, image: true } },
        replyTo: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
        attachments: true,
        reactions: true,
        mentions: true,
      },
    });

    await emitChatMessage(roomId, {
      ...message,
      systemHuddleEnded: true,
      huddleEnded: payload,
    });
  } catch (error) {
    console.warn('[call-service] Failed to post huddle-ended message:', error);
  }
};
