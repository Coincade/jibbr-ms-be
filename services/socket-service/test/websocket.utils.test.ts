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

vi.mock('jsonwebtoken', () => ({ default: { verify }, verify }));
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
  validateChannelMembership,
} from '../src/websocket/utils.js';

describe('websocket utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'secret';
  });

  it('authenticateSocket returns decoded payload', () => {
    verify.mockReturnValue({ id: 'u1' });
    expect(authenticateSocket('token')).toEqual({ id: 'u1' });
  });

  it('authenticateSocket returns null on verify error', () => {
    verify.mockImplementation(() => {
      throw new Error('bad');
    });
    expect(authenticateSocket('bad')).toBeNull();
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

  it('delegates validateChannelMembership to cached service', async () => {
    await expect(validateChannelMembership('u1', 'c1')).resolves.toBe(true);
    expect(validateChannelMembershipCached).toHaveBeenCalledWith('u1', 'c1');
  });
});
