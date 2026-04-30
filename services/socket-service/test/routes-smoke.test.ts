import { describe, expect, it, vi } from 'vitest';

vi.mock('@jibbr/auth-middleware', () => ({
  authMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));
vi.mock('../src/controllers/presence.controller.js', () => ({
  getOnlineUsersList: (_req: unknown, _res: unknown, next: () => void) => next(),
  checkUserOnlineStatus: (_req: unknown, _res: unknown, next: () => void) => next(),
  checkMultipleUsersStatus: (_req: unknown, _res: unknown, next: () => void) => next(),
  getOnlineStats: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

function listRoutes(router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }) {
  return router.stack
    .filter((layer) => !!layer.route)
    .map((layer) => `${Object.keys(layer.route!.methods)[0].toUpperCase()} ${layer.route!.path}`);
}

describe('presence routes smoke', () => {
  it('registers expected endpoints', async () => {
    const router = (await import('../src/routes/presence.route.js')).default;
    const routes = listRoutes(router);
    expect(routes).toEqual(
      expect.arrayContaining([
        'GET /online',
        'GET /online/:userId',
        'POST /online/check-multiple',
        'GET /stats',
      ])
    );
  });
});
