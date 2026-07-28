import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  message: { create: vi.fn() },
}));

const emitChatMessageMock = vi.hoisted(() => vi.fn());
const formatHuddleEndedContentMock = vi.hoisted(() => vi.fn(() => 'Huddle ended'));

vi.mock('../src/config/database.js', () => ({ default: prisma }));
vi.mock('../src/services/call-signal.service.js', () => ({
  emitChatMessage: emitChatMessageMock,
}));
vi.mock('../src/utils/huddle-message.js', () => ({
  formatHuddleEndedContent: formatHuddleEndedContentMock,
}));

describe('huddle-ended-message.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a system huddle-ended message and emits it to chat', async () => {
    prisma.message.create.mockResolvedValue({ id: 'msg-1', content: 'Huddle ended' });

    const room = {
      createdAt: new Date(Date.now() - 5 * 60_000),
      hostUserId: 'host-1',
      peakParticipantCount: 2,
    } as any;

    const { createHuddleEndedMessage } = await import('../src/services/huddle-ended-message.service.js');
    await createHuddleEndedMessage('room-1', room, 3);

    expect(formatHuddleEndedContentMock).toHaveBeenCalledWith(
      expect.objectContaining({ durationMinutes: expect.any(Number), peakCount: 3 })
    );
    expect(prisma.message.create).toHaveBeenCalled();
    expect(emitChatMessageMock).toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({
        systemHuddleEnded: true,
        huddleEnded: expect.objectContaining({ peakCount: 3 }),
      })
    );
  });

  it('returns early when the room has no host user id', async () => {
    const room = {
      createdAt: new Date(),
      hostUserId: '',
      peakParticipantCount: 1,
    } as any;

    const { createHuddleEndedMessage } = await import('../src/services/huddle-ended-message.service.js');
    await createHuddleEndedMessage('room-1', room, 1);

    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(emitChatMessageMock).not.toHaveBeenCalled();
  });
});
