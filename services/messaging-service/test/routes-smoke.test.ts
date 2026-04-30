import { describe, expect, it, vi } from 'vitest';

vi.mock('@jibbr/auth-middleware', () => ({
  authMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock('../src/config/upload.js', () => ({
  upload: { array: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()) },
}));

vi.mock('../src/config/rateLimit.js', () => ({
  collaboratorSearchLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../src/middleware/Role.middleware.js', () => ({
  default: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

const handler = () => (_req: unknown, _res: unknown, next: () => void) => next();

vi.mock('../src/controllers/message.controller.js', () => ({
  sendMessage: handler(),
  sendMessageWithAttachments: handler(),
  getMessages: handler(),
  getMessage: handler(),
  updateMessage: handler(),
  deleteMessage: handler(),
  reactToMessage: handler(),
  removeReaction: handler(),
  forwardMessage: handler(),
  getForwardedMessages: handler(),
  getMentions: handler(),
}));
vi.mock('../src/controllers/channel.controller.js', () => ({
  createChannel: handler(),
  getWorkspaceChannels: handler(),
  getChannel: handler(),
  joinChannel: handler(),
  addMemberToChannel: handler(),
  removeMemberFromChannel: handler(),
  updateChannel: handler(),
  softDeleteChannel: handler(),
  hardDeleteChannel: handler(),
  createBridgeChannel: handler(),
  inviteToBridgeChannel: handler(),
  acceptBridgeInvite: handler(),
  getBridgeChannels: handler(),
  checkInviteEmailRegistered: handler(),
}));
vi.mock('../src/controllers/workspace.controller.js', () => ({
  createWorkspace: handler(),
  getAllWorkspaces: handler(),
  getWorkspace: handler(),
  getAllWorkspacesForUser: handler(),
  getWorkspaceMembers: handler(),
  joinWorkspace: handler(),
  joinWorkspaceByCode: handler(),
  leaveWorkspace: handler(),
  updateWorkspace: handler(),
  softDeleteWorkspace: handler(),
  hardDeleteWorkspace: handler(),
  getPublicChannels: handler(),
  updateMemberRole: handler(),
}));
vi.mock('../src/controllers/conversation.controller.js', () => ({
  getOrCreateConversation: handler(),
  getUserConversations: handler(),
  getConversationMessages: handler(),
  sendDirectMessage: handler(),
  sendDirectMessageWithAttachments: handler(),
  forwardToDirectMessage: handler(),
  deleteDirectMessage: handler(),
}));
vi.mock('../src/controllers/notification.controller.js', () => ({
  markAsRead: handler(),
  getUnreadCounts: handler(),
  getUserNotifications: handler(),
  markNotificationAsRead: handler(),
  markAllNotificationsAsRead: handler(),
  getNotificationPreferences: handler(),
  updateNotificationPreferences: handler(),
  registerPushToken: handler(),
  unregisterPushToken: handler(),
  getChannelMutes: handler(),
  setChannelMute: handler(),
}));
vi.mock('../src/controllers/recents.controller.js', () => ({
  getRecents: handler(),
  touchRecent: handler(),
}));
vi.mock('../src/controllers/search.controller.js', () => ({ search: handler() }));
vi.mock('../src/controllers/user.controller.js', () => ({
  searchCollaborators: handler(),
  searchUsers: handler(),
  updateMyStatus: handler(),
  getMyStatus: handler(),
  getUserStatus: handler(),
  updateMyTimezone: handler(),
  getMe: handler(),
  updateMe: handler(),
  getUserProfile: handler(),
}));
vi.mock('../src/controllers/workspace-collaboration.controller.js', () => ({
  approveCollaborationRequest: handler(),
  createCollaborationRequest: handler(),
  createExternalDirectMessage: handler(),
  createSharedChannel: handler(),
  getCollaborationRequestInbox: handler(),
  getCollaborationRequestOutbox: handler(),
  listWorkspaceCollaborations: handler(),
  rejectCollaborationRequest: handler(),
  revokeCollaborationLink: handler(),
}));
vi.mock('../src/controllers/collaboration-group.controller.js', () => ({
  acceptGroupInvite: handler(),
  createGroup: handler(),
  createGroupSharedChannel: handler(),
  getGroup: handler(),
  inviteWorkspace: handler(),
  listGroups: handler(),
  rejectGroupInvite: handler(),
  revokeGroupMembership: handler(),
}));

function listRoutes(router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }) {
  return router.stack
    .filter((layer) => !!layer.route)
    .map((layer) => {
      const route = layer.route!;
      const method = Object.keys(route.methods)[0]?.toUpperCase() ?? 'UNKNOWN';
      return `${method} ${route.path}`;
    });
}

describe('routes smoke registration', () => {
  it('registers expected messaging endpoints', async () => {
    const messageRouter = (await import('../src/routes/message.route.js')).default;
    const channelRouter = (await import('../src/routes/channel.route.js')).default;
    const workspaceRouter = (await import('../src/routes/workspace.route.js')).default;

    const messageRoutes = listRoutes(messageRouter);
    const channelRoutes = listRoutes(channelRouter);
    const workspaceRoutes = listRoutes(workspaceRouter);

    expect(messageRoutes).toEqual(
      expect.arrayContaining(['POST /send', 'GET /channel/:channelId', 'GET /mentions'])
    );
    expect(channelRoutes).toEqual(
      expect.arrayContaining(['POST /create', 'GET /workspace/:workspaceId', 'DELETE /:id/soft'])
    );
    expect(workspaceRoutes).toEqual(
      expect.arrayContaining(['POST /create', 'POST /join-by-code', 'DELETE /:id/hard'])
    );
  });

  it('registers expected collaboration and utility endpoints', async () => {
    const collaborationRouter = (await import('../src/routes/workspace-collaboration.route.js')).default;
    const groupRouter = (await import('../src/routes/collaboration-group.route.js')).default;
    const searchRouter = (await import('../src/routes/search.route.js')).default;
    const recentsRouter = (await import('../src/routes/recents.route.js')).default;

    const collaborationRoutes = listRoutes(collaborationRouter);
    const groupRoutes = listRoutes(groupRouter);
    const searchRoutes = listRoutes(searchRouter);
    const recentsRoutes = listRoutes(recentsRouter);

    expect(collaborationRoutes).toEqual(
      expect.arrayContaining(['POST /requests', 'POST /links/:id/shared-channels', 'POST /links/:id/external-dm'])
    );
    expect(groupRoutes).toEqual(
      expect.arrayContaining(['POST /', 'POST /:id/invite', 'POST /:id/shared-channels'])
    );
    expect(searchRoutes).toEqual(expect.arrayContaining(['GET /']));
    expect(recentsRoutes).toEqual(expect.arrayContaining(['GET /', 'POST /']));
  });

  it('registers expected user and notification endpoints', async () => {
    const userRouter = (await import('../src/routes/user.route.js')).default;
    const notificationRouter = (await import('../src/routes/notification.route.js')).default;
    const conversationRouter = (await import('../src/routes/conversation.route.js')).default;

    const userRoutes = listRoutes(userRouter);
    const notificationRoutes = listRoutes(notificationRouter);
    const conversationRoutes = listRoutes(conversationRouter);

    expect(userRoutes).toEqual(
      expect.arrayContaining(['GET /search', 'GET /me', 'PATCH /me/status', 'PATCH /me/timezone'])
    );
    expect(notificationRoutes).toEqual(
      expect.arrayContaining(['POST /mark-as-read', 'GET /notifications', 'PUT /channel-mutes'])
    );
    expect(conversationRoutes).toEqual(
      expect.arrayContaining(['GET /with/:targetUserId', 'POST /:conversationId/messages', 'DELETE /:conversationId/messages/:messageId'])
    );
  });
});
