import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  member: { findMany: vi.fn() },
  workspaceCollaboration: { findMany: vi.fn() },
  collaborationGroupMembership: { findMany: vi.fn() },
  channelMember: { findMany: vi.fn() },
  channel: { findMany: vi.fn() },
  conversationParticipant: { findMany: vi.fn() },
  message: { findMany: vi.fn() },
  attachment: { findMany: vi.fn() },
}));

vi.mock('../src/config/database.js', () => ({
  default: prismaMock,
}));

import { performSearch } from '../src/services/search.service.js';

describe('search.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.workspaceCollaboration.findMany.mockResolvedValue([]);
    prismaMock.collaborationGroupMembership.findMany.mockResolvedValue([]);
    prismaMock.channelMember.findMany.mockResolvedValue([]);
    prismaMock.channel.findMany.mockResolvedValue([]);
    prismaMock.conversationParticipant.findMany.mockResolvedValue([]);
    prismaMock.message.findMany.mockResolvedValue([]);
    prismaMock.attachment.findMany.mockResolvedValue([]);
    prismaMock.member.findMany.mockResolvedValue([]);
  });

  it('returns empty result when user has no workspace memberships', async () => {
    prismaMock.member.findMany.mockResolvedValueOnce([]);

    const result = await performSearch('u1', { q: 'hello' });

    expect(result).toMatchObject({
      messages: [],
      channels: [],
      users: [],
      files: [],
      total: 0,
      query: 'hello',
      total_channels: 0,
      total_users: 0,
      total_messages: 0,
      total_files: 0,
    });
  });

  it('builds message filter with link and image constraints', async () => {
    prismaMock.member.findMany
      .mockResolvedValueOnce([{ workspaceId: 'w1' }]) // memberships
      .mockResolvedValueOnce([]); // searchUsers member query
    prismaMock.channelMember.findMany.mockResolvedValue([{ channelId: 'c1' }]);
    prismaMock.channel.findMany.mockResolvedValue([
      { id: 'c1', name: 'general', type: 'PUBLIC', image: null, workspaceId: 'w1', _count: { members: 3 } },
    ]);
    prismaMock.conversationParticipant.findMany.mockResolvedValue([]);
    prismaMock.message.findMany
      .mockResolvedValueOnce([]) // searchMessages
      .mockResolvedValueOnce([]); // searchFiles messages
    prismaMock.attachment.findMany.mockResolvedValue([]);

    await performSearch('u1', { q: 'foo', has: 'link' });
    const messageWhereLink = prismaMock.message.findMany.mock.calls[0][0].where;
    expect(messageWhereLink.AND).toEqual([
      { content: { contains: 'foo', mode: 'insensitive' } },
      { content: { contains: 'http', mode: 'insensitive' } },
    ]);

    vi.clearAllMocks();
    prismaMock.workspaceCollaboration.findMany.mockResolvedValue([]);
    prismaMock.collaborationGroupMembership.findMany.mockResolvedValue([]);
    prismaMock.member.findMany
      .mockResolvedValueOnce([{ workspaceId: 'w1' }])
      .mockResolvedValueOnce([]);
    prismaMock.channelMember.findMany.mockResolvedValue([{ channelId: 'c1' }]);
    prismaMock.channel.findMany.mockResolvedValue([
      { id: 'c1', name: 'general', type: 'PUBLIC', image: null, workspaceId: 'w1', _count: { members: 3 } },
    ]);
    prismaMock.conversationParticipant.findMany.mockResolvedValue([]);
    prismaMock.message.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prismaMock.attachment.findMany.mockResolvedValue([]);

    await performSearch('u1', { q: 'foo', has: 'image' });
    const messageWhereImage = prismaMock.message.findMany.mock.calls[0][0].where;
    expect(messageWhereImage.attachments).toEqual({
      some: { mimeType: { startsWith: 'image/' } },
    });
  });

  it('includes collaborator workspaces when discovery is enabled', async () => {
    prismaMock.member.findMany
      .mockResolvedValueOnce([{ workspaceId: 'w1' }])
      .mockResolvedValueOnce([]);
    prismaMock.workspaceCollaboration.findMany.mockResolvedValue([
      {
        workspaceAId: 'w1',
        workspaceBId: 'w2',
        policy: { allowExternalDiscovery: true },
      },
    ]);
    prismaMock.channelMember.findMany.mockResolvedValue([]);
    prismaMock.channel.findMany.mockResolvedValue([]);
    prismaMock.conversationParticipant.findMany.mockResolvedValue([]);
    prismaMock.message.findMany.mockResolvedValue([]);
    prismaMock.attachment.findMany.mockResolvedValue([]);

    await performSearch('u1', { q: 'hello' });

    expect(prismaMock.channel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: { in: expect.arrayContaining(['w1', 'w2']) },
        }),
      })
    );
  });

  it('computes has_more and totals from all result groups', async () => {
    prismaMock.member.findMany
      .mockResolvedValueOnce([{ workspaceId: 'w1' }])
      .mockResolvedValueOnce([
        {
          workspaceId: 'w1',
          user: { id: 'u2', name: 'Alice', email: 'alice@example.com', image: null, presenceStatus: 'ONLINE' },
          workspace: { id: 'w1', name: 'Main' },
        },
      ]);
    prismaMock.channelMember.findMany.mockResolvedValue([{ channelId: 'c1' }]);
    prismaMock.channel.findMany.mockResolvedValue([
      { id: 'c1', name: 'general', type: 'PUBLIC', image: null, workspaceId: 'w1', _count: { members: 3 } },
      { id: 'c2', name: 'random', type: 'PUBLIC', image: null, workspaceId: 'w1', _count: { members: 2 } },
      { id: 'c3', name: 'eng', type: 'PUBLIC', image: null, workspaceId: 'w1', _count: { members: 4 } },
      { id: 'c4', name: 'ops', type: 'PUBLIC', image: null, workspaceId: 'w1', _count: { members: 5 } },
    ]);
    prismaMock.conversationParticipant.findMany.mockResolvedValue([]);
    prismaMock.message.findMany
      .mockResolvedValueOnce([
        {
          id: 'm1',
          content: 'hello world',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          channel: { id: 'c1', name: 'general' },
          user: { id: 'u1', name: 'User 1', image: null },
          channelId: 'c1',
          userId: 'u1',
        },
        {
          id: 'm2',
          content: 'hello again',
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
          channel: { id: 'c1', name: 'general' },
          user: { id: 'u1', name: 'User 1', image: null },
          channelId: 'c1',
          userId: 'u1',
        },
      ])
      .mockResolvedValueOnce([{ id: 'm1', channelId: 'c1', userId: 'u1' }]);
    prismaMock.attachment.findMany.mockResolvedValue([
      {
        id: 'a1',
        filename: 'hello.png',
        originalName: 'hello.png',
        mimeType: 'image/png',
        size: 1,
        url: 'u',
        messageId: 'm1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        message: { channelId: 'c1', userId: 'u1' },
      },
    ]);

    const result = await performSearch('u1', { q: '', limit: 20 });

    expect(result.total_channels).toBe(4);
    expect(result.total_messages).toBe(2);
    expect(result.total_users).toBe(1);
    expect(result.total_files).toBe(1);
    expect(result.has_more).toBe(true);
    expect(result.total).toBe(7); // quota-limited shown count
    expect(result.total_results).toBe(8);
  });

  it('applies date/user/channel filters in message where clause', async () => {
    prismaMock.member.findMany
      .mockResolvedValueOnce([{ workspaceId: 'w1' }])
      .mockResolvedValueOnce([]);
    prismaMock.channelMember.findMany.mockResolvedValue([{ channelId: 'c1' }]);
    prismaMock.channel.findMany.mockResolvedValue([
      { id: 'c1', name: 'general', type: 'PUBLIC', image: null, workspaceId: 'w1', _count: { members: 3 } },
    ]);
    prismaMock.conversationParticipant.findMany.mockResolvedValue([]);
    prismaMock.message.findMany.mockResolvedValue([]);
    prismaMock.attachment.findMany.mockResolvedValue([]);

    await performSearch('u1', {
      q: 'hello',
      from: 'u2',
      in: 'c1',
      before: '2026-01-05T00:00:00.000Z',
    });

    const where = prismaMock.message.findMany.mock.calls[0][0].where;
    expect(where.userId).toBe('u2');
    expect(where.channelId).toBe('c1');
    expect(where.createdAt).toEqual({ lt: new Date('2026-01-05T00:00:00.000Z') });
  });
});
