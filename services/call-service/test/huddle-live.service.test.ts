import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  member: { findFirst: vi.fn() },
  channel: { findMany: vi.fn(), findUnique: vi.fn() },
  conversationParticipant: { findMany: vi.fn() },
  conversation: { findUnique: vi.fn() },
}));

const getActiveRoomIds = vi.hoisted(() => vi.fn(() => [] as string[]));
const getRoomSnapshot = vi.hoisted(() => vi.fn());

vi.mock('../src/config/database.js', () => ({ default: prisma }));
vi.mock('../src/mediasoup/rooms.js', () => ({
  getActiveRoomIds,
  getRoomSnapshot,
}));

import {
  assertWorkspaceMember,
  buildWorkspaceHuddleInactivePayload,
  buildWorkspaceHuddlePayload,
  listLiveHuddlesForWorkspace,
  resolveWorkspaceIdForRoom,
} from '../src/services/huddle-live.service.js';

describe('huddle-live.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.channel.findMany.mockResolvedValue([]);
    prisma.conversationParticipant.findMany.mockResolvedValue([]);
    getActiveRoomIds.mockReturnValue([]);
  });

  it('assertWorkspaceMember resolves for an active member and rejects otherwise', async () => {
    prisma.member.findFirst.mockResolvedValueOnce({ id: 'm1' });
    await expect(assertWorkspaceMember('user-1', 'w1')).resolves.toBeUndefined();

    prisma.member.findFirst.mockResolvedValueOnce(null);
    await expect(assertWorkspaceMember('user-1', 'w1')).rejects.toThrow(
      'You are not a member of this workspace'
    );
  });

  it('lists a live channel huddle the user can see', async () => {
    prisma.member.findFirst.mockResolvedValue({ id: 'm1' });
    prisma.channel.findMany.mockResolvedValue([{ id: 'ch-1', name: 'general' }]);
    getActiveRoomIds.mockReturnValue(['ch-1', 'other']);
    getRoomSnapshot.mockImplementation((roomId: string) =>
      roomId === 'ch-1'
        ? {
            participantCount: 2,
            hostUserId: 'host-1',
            startedAt: '2026-01-05T10:00:00.000Z',
          }
        : undefined
    );

    const huddles = await listLiveHuddlesForWorkspace('w1', 'user-1');

    expect(huddles).toEqual([
      {
        roomId: 'ch-1',
        channelId: 'ch-1',
        conversationId: null,
        channelName: 'general',
        participantCount: 2,
        hostUserId: 'host-1',
        startedAt: '2026-01-05T10:00:00.000Z',
      },
    ]);
  });

  it('resolves a workspace id from a conversation room and a channel room', async () => {
    prisma.conversation.findUnique.mockResolvedValue({ workspaceId: 'w-conv' });
    await expect(resolveWorkspaceIdForRoom('conv:cv-1')).resolves.toBe('w-conv');

    prisma.channel.findUnique.mockResolvedValue({ workspaceId: 'w-ch' });
    await expect(resolveWorkspaceIdForRoom('ch-1')).resolves.toBe('w-ch');

    prisma.channel.findUnique.mockResolvedValue(null);
    await expect(resolveWorkspaceIdForRoom('missing')).resolves.toBeNull();
  });

  it('builds active and inactive workspace huddle payloads', () => {
    const active = buildWorkspaceHuddlePayload(
      'w1',
      'ch-1',
      {
        participantCount: 3,
        hostUserId: 'host-1',
        startedAt: '2026-01-05T10:00:00.000Z',
      } as any,
      { channelName: 'general', startedByName: 'Asha' }
    );
    expect(active).toMatchObject({
      workspaceId: 'w1',
      roomId: 'ch-1',
      channelId: 'ch-1',
      active: true,
      participantCount: 3,
      channelName: 'general',
      startedByName: 'Asha',
    });

    expect(buildWorkspaceHuddleInactivePayload('w1', 'conv:cv-1')).toEqual({
      workspaceId: 'w1',
      roomId: 'conv:cv-1',
      channelId: undefined,
      conversationId: 'cv-1',
      active: false,
    });
  });
});
