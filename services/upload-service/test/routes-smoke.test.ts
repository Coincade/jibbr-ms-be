import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/middleware/Auth.middleware.js', () => ({
  default: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../src/controllers/upload.controller.js', () => ({
  upload: { array: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()) },
  uploadProfilePicture: {
    single: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  },
  uploadFiles: (_req: unknown, _res: unknown, next: () => void) => next(),
  uploadProfilePictureFile: (_req: unknown, _res: unknown, next: () => void) => next(),
  getUploadProgress: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

function listRoutes(router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }) {
  return router.stack
    .filter((layer) => !!layer.route)
    .map((layer) => `${Object.keys(layer.route!.methods)[0].toUpperCase()} ${layer.route!.path}`);
}

describe('upload routes smoke', () => {
  it('registers expected endpoints', async () => {
    const router = (await import('../src/routes/upload.route.js')).default;
    const routes = listRoutes(router);
    expect(routes).toEqual(
      expect.arrayContaining([
        'POST /files',
        'POST /profile-picture',
        'GET /progress/:uploadId',
      ])
    );
  });
});
