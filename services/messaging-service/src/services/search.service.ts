import prisma from '../config/database.js';
import type { Prisma } from '@prisma/client';

export interface SearchParams {
  q: string;
  from?: string;
  in?: string;
  has?: string;
  before?: string;
  after?: string;
  limit?: number;
  offset?: number;
}

export interface SearchResults {
  messages: Array<{
    id: string;
    content: string;
    channel: string;
    user: string;
    created_at: string;
    channel_id?: string;
    user_id?: string;
    avatar?: string;
  }>;
  channels: Array<{
    id: string;
    name: string;
    joined: boolean;
    description?: string;
    member_count?: number;
    type?: 'public' | 'private';
    image?: string;
    /** Home workspace of the channel (needed for collab / partner public channels). */
    workspace_id?: string;
  }>;
  users: Array<{
    id: string;
    username: string;
    avatar: string;
    display_name?: string;
    status?: string;
  }>;
  files: Array<{
    id: string;
    filename: string;
    original_name: string;
    mime_type: string;
    size: number;
    url: string;
    message_id: string;
    channel_id?: string;
    user_id?: string;
    created_at: string;
    thumbnail_url?: string;
  }>;
  total: number;
  query: string;
  took: number;
  has_more?: boolean;
  total_results?: number;
  total_channels?: number;
  total_users?: number;
  total_messages?: number;
  total_files?: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Counterpart workspaces for global search (people + public channels) when collab allows discovery. */
async function getCollaborationSearchWorkspaceIds(
  userMemberWorkspaceIds: string[]
): Promise<string[]> {
  if (userMemberWorkspaceIds.length === 0) return [];
  const links = await prisma.workspaceCollaboration.findMany({
    where: {
      status: 'ACTIVE',
      OR: [
        { workspaceAId: { in: userMemberWorkspaceIds } },
        { workspaceBId: { in: userMemberWorkspaceIds } },
      ],
    },
    include: {
      policy: { select: { allowExternalDiscovery: true } },
    },
  });
  const extra = new Set<string>();
  for (const link of links) {
    if (!link.policy.allowExternalDiscovery) continue;
    if (userMemberWorkspaceIds.includes(link.workspaceAId)) {
      extra.add(link.workspaceBId);
    }
    if (userMemberWorkspaceIds.includes(link.workspaceBId)) {
      extra.add(link.workspaceAId);
    }
  }
  return [...extra];
}

/** Display quotas: show top N per group for focused results */
const CHANNELS_QUOTA = 3;
const USERS_QUOTA = 2;
const MESSAGES_QUOTA = 5;
const FILES_QUOTA = 3;

/** Score channel by name match quality (higher = better) */
function scoreChannel(
  name: string,
  term: string,
  joined: boolean
): number {
  if (!term) return joined ? 10 : 5;
  const n = name.toLowerCase();
  const t = term.toLowerCase();
  if (n === t) return 100;
  if (n.startsWith(t)) return 80;
  if (n.includes(t)) return 50;
  return 0;
}

/** Score user by name/email match */
function scoreUser(
  name: string | null,
  email: string | null,
  term: string,
  status?: string | null
): number {
  const n = (name || '').toLowerCase();
  const e = (email || '').toLowerCase();
  const t = term.toLowerCase();
  let score = 0;
  if (t) {
    if (n === t || e.startsWith(t)) score = 90;
    else if (n.startsWith(t) || e.includes(t)) score = 70;
    else if (n.includes(t)) score = 50;
  } else {
    score = 5;
  }
  if (status && ['available', 'online'].includes(status.toLowerCase())) score += 10;
  return score;
}

/** Score message by content match + recency decay */
function scoreMessage(
  content: string,
  term: string,
  createdAt: Date
): number {
  const c = content.toLowerCase();
  const t = term.toLowerCase();
  let score = 0;
  if (t && c.includes(t)) {
    const idx = c.indexOf(t);
    score = 60 - Math.min(idx / 10, 30);
    if (c.startsWith(t)) score += 20;
  } else if (!t) {
    score = 30;
  }
  const ageHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
  const recency = Math.max(0, 30 - ageHours * 0.5);
  return score + recency;
}

export async function performSearch(
  userId: string,
  params: SearchParams
): Promise<SearchResults> {
  const start = Date.now();
  const q = (params.q || '').trim();
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = params.offset ?? 0;

  // Get user's accessible workspaces
  const memberships = await prisma.member.findMany({
    where: { userId, isActive: true },
    select: { workspaceId: true },
  });
  const workspaceIds = memberships.map((m) => m.workspaceId);
  if (workspaceIds.length === 0) {
    return emptyResults(q, Date.now() - start);
  }

  const collaboratorWorkspaceIds = await getCollaborationSearchWorkspaceIds(workspaceIds);
  const searchWorkspaceIds = [...new Set([...workspaceIds, ...collaboratorWorkspaceIds])];

  // Channels user is a member of
  const channelMemberships = await prisma.channelMember.findMany({
    where: { userId, isActive: true },
    select: { channelId: true },
  });
  const joinedChannelIds = new Set(channelMemberships.map((c) => c.channelId));

  // All channels in member workspaces + linked workspaces (public channel discovery in partner org)
  const allChannelsInWorkspaces = await prisma.channel.findMany({
    where: {
      workspaceId: { in: searchWorkspaceIds },
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      type: true,
      image: true,
      workspaceId: true,
      _count: { select: { members: true } },
    },
  });

  // Channel IDs user can search messages in (joined channels only - must be member to see messages)
  const searchableChannelIds = allChannelsInWorkspaces
    .filter((c) => joinedChannelIds.has(c.id))
    .map((c) => c.id);

  // DM conversations user participates in
  const dmParticipations = await prisma.conversationParticipant.findMany({
    where: { userId, isActive: true },
    select: { conversationId: true },
  });
  const dmConversationIds = dmParticipations.map((p) => p.conversationId);

  const searchTerm = q ? `%${q}%` : null;

  // Build message where clause
  const orParts: Prisma.MessageWhereInput[] = [];
  if (searchableChannelIds.length > 0) {
    orParts.push({ channelId: { in: searchableChannelIds } });
  }
  if (dmConversationIds.length > 0) {
    orParts.push({ conversationId: { in: dmConversationIds } });
  }
  if (orParts.length === 0) {
    orParts.push({ channelId: 'impossible' }); // no accessible channels
  }

  const messageWhere: Prisma.MessageWhereInput = {
    deletedAt: null,
    OR: orParts,
  };

  if (params.from) {
    messageWhere.userId = params.from;
  }
  if (params.in) {
    messageWhere.channelId = params.in;
  }
  if (params.before) {
    const beforeDate = parseDate(params.before);
    if (beforeDate) messageWhere.createdAt = { lt: beforeDate };
    else messageWhere.createdAt = { lt: new Date(params.before) };
  }
  if (params.after) {
    const afterDate = parseDate(params.after);
    if (afterDate) messageWhere.createdAt = { gt: afterDate };
    else messageWhere.createdAt = { gt: new Date(params.after) };
  }

  if (searchTerm && params.has === 'link') {
    messageWhere.AND = [
      { content: { contains: q, mode: 'insensitive' } },
      { content: { contains: 'http', mode: 'insensitive' } },
    ];
  } else if (searchTerm) {
    messageWhere.content = { contains: q, mode: 'insensitive' };
  } else if (params.has === 'link') {
    messageWhere.content = { contains: 'http', mode: 'insensitive' };
  }

  if (params.has === 'image') {
    messageWhere.attachments = {
      some: { mimeType: { startsWith: 'image/' } },
    };
  }

  const [messagesRes, channelsRes, usersRes, filesRes] = await Promise.all([
    searchMessages(messageWhere, searchTerm, limit, offset),
    searchChannels(searchWorkspaceIds, searchTerm, joinedChannelIds, allChannelsInWorkspaces),
    searchUsers(searchWorkspaceIds, searchTerm, userId),
    searchFiles(messageWhere, searchTerm, limit),
  ]);

  const totalShown =
    messagesRes.messages.length +
    channelsRes.channels.length +
    usersRes.users.length +
    filesRes.files.length;
  const totalResults =
    messagesRes.total +
    channelsRes.total +
    usersRes.total +
    filesRes.total;

  return {
    messages: messagesRes.messages,
    channels: channelsRes.channels,
    users: usersRes.users,
    files: filesRes.files,
    total: totalShown,
    query: q || '',
    took: Date.now() - start,
    has_more: totalResults > totalShown,
    total_results: totalResults,
    total_channels: channelsRes.total,
    total_users: usersRes.total,
    total_messages: messagesRes.total,
    total_files: filesRes.total,
  };
}

function parseDate(s: string): Date | null {
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function emptyResults(q: string, took: number): SearchResults {
  return {
    messages: [],
    channels: [],
    users: [],
    files: [],
    total: 0,
    query: q,
    took,
    total_channels: 0,
    total_users: 0,
    total_messages: 0,
    total_files: 0,
  };
}

async function searchMessages(
  where: Prisma.MessageWhereInput,
  searchTerm: string | null,
  limit: number,
  offset: number
): Promise<{ messages: SearchResults['messages']; total: number }> {
  const rows = await prisma.message.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.max(limit, 50),
    skip: offset,
    include: {
      user: { select: { id: true, name: true, image: true } },
      channel: { select: { id: true, name: true } },
    },
  });

  const term = searchTerm?.replace(/%/g, '') ?? '';
  const scored = rows
    .map((m) => ({
      item: m,
      score: scoreMessage(m.content, term, m.createdAt),
    }))
    .filter((s) => s.score > 0 || !term)
    .sort((a, b) => b.score - a.score);

  const total = scored.length;
  const top = scored.slice(0, MESSAGES_QUOTA).map((s) => ({
    id: s.item.id,
    content: s.item.content,
    channel: s.item.channel?.name ?? '',
    user: s.item.user?.name ?? '',
    created_at: s.item.createdAt.toISOString(),
    channel_id: s.item.channelId ?? undefined,
    user_id: s.item.userId,
    avatar: s.item.user?.image ?? undefined,
  }));

  return { messages: top, total };
}

async function searchChannels(
  _workspaceIds: string[],
  searchTerm: string | null,
  joinedChannelIds: Set<string>,
  allChannels: Array<{
    id: string;
    name: string;
    type: string;
    image: string | null;
    workspaceId: string;
    _count: { members: number };
  }>
): Promise<{ channels: SearchResults['channels']; total: number }> {
  const term = searchTerm?.replace(/%/g, '') ?? '';
  // Only show: (1) channels user is in, or (2) public channels user can join
  let filtered = allChannels.filter(
    (c) => joinedChannelIds.has(c.id) || c.type === 'PUBLIC'
  );
  if (term) {
    filtered = filtered.filter((c) => c.name.toLowerCase().includes(term.toLowerCase()));
  }

  const scored = filtered
    .map((c) => ({
      item: c,
      score: scoreChannel(c.name, term, joinedChannelIds.has(c.id)),
    }))
    .filter((s) => s.score > 0 || !term)
    .sort((a, b) => b.score - a.score);

  const total = scored.length;
  const top = scored.slice(0, CHANNELS_QUOTA).map((s) => ({
    id: s.item.id,
    name: s.item.name,
    joined: joinedChannelIds.has(s.item.id),
    member_count: s.item._count.members,
    type: (s.item.type === 'PUBLIC' ? 'public' : 'private') as 'public' | 'private',
    image: s.item.image ?? undefined,
    workspace_id: s.item.workspaceId,
  }));

  return { channels: top, total };
}

async function searchUsers(
  workspaceIds: string[],
  searchTerm: string | null,
  excludeUserId: string
): Promise<{ users: SearchResults['users']; total: number }> {
  const members = await prisma.member.findMany({
    where: {
      workspaceId: { in: workspaceIds },
      isActive: true,
      userId: { not: excludeUserId },
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          presenceStatus: true,
        },
      },
    },
  });

  const term = searchTerm?.replace(/%/g, '') ?? '';
  const userById = new Map<string, NonNullable<(typeof members)[0]['user']>>();
  for (const m of members) {
    const u = m.user;
    if (!u) continue;
    if (!userById.has(u.id)) userById.set(u.id, u);
  }
  let users = Array.from(userById.values());
  if (term) {
    users = users.filter(
      (u) =>
        u?.name?.toLowerCase().includes(term) ||
        u?.email?.toLowerCase().includes(term)
    );
  }

  const scored = users
    .map((u) => ({
      item: u!,
      score: scoreUser(u!.name, u!.email, term, u!.presenceStatus),
    }))
    .filter((s) => s.score > 0 || !term)
    .sort((a, b) => b.score - a.score);

  const total = scored.length;
  const top = scored.slice(0, USERS_QUOTA).map((s) => ({
    id: s.item.id,
    username: s.item.email?.split('@')[0] ?? s.item.name ?? '',
    avatar: s.item.image ?? '',
    display_name: s.item.name ?? undefined,
    name: s.item.name ?? undefined,
    status: s.item.presenceStatus?.toLowerCase() ?? undefined,
  }));

  return { users: top, total };
}

async function searchFiles(
  messageWhere: Prisma.MessageWhereInput,
  searchTerm: string | null,
  limit: number
): Promise<{ files: SearchResults['files']; total: number }> {
  const messages = await prisma.message.findMany({
    where: {
      AND: [messageWhere, { attachments: { some: {} } }],
    },
    select: { id: true, channelId: true, userId: true },
    take: limit * 4,
  });

  const messageIds = messages.map((m) => m.id);
  const attachments = await prisma.attachment.findMany({
    where: { messageId: { in: messageIds } },
    include: { message: true },
  });

  const term = searchTerm?.replace(/%/g, '').toLowerCase() ?? '';
  let filtered = attachments;
  if (term) {
    filtered = filtered.filter(
      (a) =>
        a.originalName.toLowerCase().includes(term) ||
        a.filename.toLowerCase().includes(term)
    );
  }

  const total = filtered.length;
  const top = filtered.slice(0, FILES_QUOTA).map((a) => ({
    id: a.id,
    filename: a.filename,
    original_name: a.originalName,
    mime_type: a.mimeType,
    size: a.size,
    url: a.url,
    message_id: a.messageId,
    channel_id: a.message?.channelId ?? undefined,
    user_id: a.message?.userId ?? undefined,
    created_at: a.createdAt.toISOString(),
  }));

  return { files: top, total };
}
