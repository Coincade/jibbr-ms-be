import { beforeEach, describe, expect, it, vi } from 'vitest';

const verify = vi.hoisted(() => vi.fn());
const validateChannelMembershipCached = vi.hoisted(() => vi.fn(async () => true));
const validateConversationParticipationCached = vi.hoisted(() => vi.fn(async () => true));
const validateWorkspaceMembershipCached = vi.hoisted(() => vi.fn(async () => true));
const PrismaClient = vi.hoisted(() =>
  vi.fn(function PrismaClient() {
    return {};
  })
);

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(async () => ({ tokenVersion: 0 })),
  },
}));

vi.mock('jsonwebtoken', () => ({ default: { verify }, verify }));
vi.mock('../src/config/database.js', () => ({ default: prismaMock }));
vi.mock('../src/services/socket-membership-cache.service.js', () => ({
  validateChannelMembershipCached,
  validateConversationParticipationCached,
  validateWorkspaceMembershipCached,
}));
vi.mock('@jibbr/database', () => ({
  PrismaClient,
  canUserMutateSharedChannel: vi.fn(async () => true),
  canUserReadChannelHistory: vi.fn(async () => true),
  isCollaborationDmMutationAllowedForConversation: vi.fn(async () => true),
}));

import {
  addClientToChannel,
  authenticateSocket,
  removeClientFromAllChannels,
  removeClientFromChannel,
  validateChannelMembership,
} from '../src/websocket/utils.js';

describe('websocket utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'secret';
    prismaMock.user.findUnique.mockResolvedValue({ tokenVersion: 0 });
  });

  it('authenticateSocket returns decoded payload', async () => {
    verify.mockReturnValue({ id: 'u1', tv: 0 });
    await expect(authenticateSocket('token')).resolves.toEqual({ id: 'u1', tv: 0 });
  });

  it('authenticateSocket returns null on verify error', async () => {
    verify.mockImplementation(() => {
      throw new Error('bad');
    });
    await expect(authenticateSocket('bad')).resolves.toBeNull();
  });

  it('authenticateSocket returns null when tokenVersion mismatches', async () => {
    verify.mockReturnValue({ id: 'u1', tv: 0 });
    prismaMock.user.findUnique.mockResolvedValue({ tokenVersion: 3 });
    await expect(authenticateSocket('token')).resolves.toBeNull();
  });

  it('adds and removes client from channel map', () => {
    const join = vi.fn();
    const leave = vi.fn();
    const socket: any = { id: 's1', join, leave };
    const map = new Map<string, Set<any>>();
    addClientToChannel(socket, 'c1', map);
    expect(join).toHaveBeenCalledWith('c1');
    expect(map.get('c1')?.has(socket)).toBe(true);
    removeClientFromAllChannels(socket, map);
    expect(leave).toHaveBeenCalledWith('c1');
  });

  it('removeClientFromChannel only leaves the requested channel', () => {
    const join = vi.fn();
    const leave = vi.fn();
    const socket: any = { id: 's1', join, leave };
    const map = new Map<string, Set<any>>();
    addClientToChannel(socket, 'c1', map);
    addClientToChannel(socket, 'c2', map);
    removeClientFromChannel(socket, 'c1', map);
    expect(leave).toHaveBeenCalledTimes(1);
    expect(leave).toHaveBeenCalledWith('c1');
    expect(map.get('c1')?.has(socket)).toBeFalsy();
    expect(map.get('c2')?.has(socket)).toBe(true);
  });

  it('delegates validateChannelMembership to cached service', async () => {
    await expect(validateChannelMembership('u1', 'c1')).resolves.toBe(true);
    expect(validateChannelMembershipCached).toHaveBeenCalledWith('u1', 'c1');
  });
});
