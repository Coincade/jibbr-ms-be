import { beforeEach, describe, expect, it, vi } from 'vitest';

const validateChannelMembership = vi.hoisted(() => vi.fn(async () => true));
const assertCanMutateSharedChannel = vi.hoisted(() => vi.fn(async () => undefined));

const prisma = vi.hoisted(() => ({
  reaction: {
    create: vi.fn(),
    findFirst: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../src/websocket/utils.js', () => ({
  validateChannelMembership,
  assertCanMutateSharedChannel,
}));
vi.mock('../src/config/database.js', () => ({ default: prisma }));

import {
  handleAddReaction,
  handleRemoveReaction,
} from '../src/websocket/handlers/reaction.handler.js';

function createSocket() {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit: vi.fn() }));
  return {
    data: { user: { id: 'u1' } },
    emit,
    to,
  } as any;
}

describe('reaction.handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds reaction and emits ack when clientOpId present', async () => {
    const socket = createSocket();
    prisma.reaction.create.mockResolvedValue({
      id: 'r1',
      emoji: ':+1:',
      messageId: 'm1',
      userId: 'u1',
      createdAt: new Date(),
      user: { id: 'u1', name: 'User' },
    });

    await handleAddReaction(
      socket,
      { channelId: 'c1', messageId: 'm1', emoji: ':+1:', clientOpId: 'op1' } as any,
      new Map()
    );

    expect(validateChannelMembership).toHaveBeenCalledWith('u1', 'c1');
    expect(assertCanMutateSharedChannel).toHaveBeenCalledWith('u1', 'c1');
    expect(socket.emit).toHaveBeenCalledWith(
      'reaction_added_ack',
      expect.objectContaining({ clientOpId: 'op1', reactionId: 'r1' })
    );
  });

  it('acks as noop for duplicate add (P2002)', async () => {
    const socket = createSocket();
    prisma.reaction.create.mockRejectedValue({ code: 'P2002' });
    prisma.reaction.findFirst.mockResolvedValue({
      id: 'r1',
      emoji: ':+1:',
      messageId: 'm1',
      userId: 'u1',
      user: { id: 'u1', name: 'User' },
    });

    await handleAddReaction(
      socket,
      { channelId: 'c1', messageId: 'm1', emoji: ':+1:', clientOpId: 'op1' } as any,
      new Map()
    );

    expect(socket.emit).toHaveBeenCalledWith(
      'reaction_added_ack',
      expect.objectContaining({ clientOpId: 'op1', noop: true })
    );
  });

  it('removes reaction and emits ack', async () => {
    const socket = createSocket();
    prisma.reaction.findFirst.mockResolvedValue({ id: 'r1' });

    await handleRemoveReaction(
      socket,
      { channelId: 'c1', messageId: 'm1', emoji: ':+1:', clientOpId: 'op2' } as any,
      new Map()
    );

    expect(prisma.reaction.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
    expect(socket.emit).toHaveBeenCalledWith(
      'reaction_removed_ack',
      expect.objectContaining({ clientOpId: 'op2', messageId: 'm1' })
    );
  });

  it('emits noop ack when reaction does not exist', async () => {
    const socket = createSocket();
    prisma.reaction.findFirst.mockResolvedValue(null);

    await handleRemoveReaction(
      socket,
      { channelId: 'c1', messageId: 'm1', emoji: ':+1:', clientOpId: 'op2' } as any,
      new Map()
    );

    expect(socket.emit).toHaveBeenCalledWith(
      'reaction_removed_ack',
      expect.objectContaining({ clientOpId: 'op2', noop: true })
    );
  });
});
