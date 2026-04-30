import { beforeEach, describe, expect, it, vi } from 'vitest';

const listen = vi.hoisted(() => vi.fn((_port: number, cb: () => void) => cb()));
const createUploadApp = vi.hoisted(() => vi.fn(() => ({ listen })));
const info = vi.hoisted(() => vi.fn());
const Logger = vi.hoisted(() =>
  vi.fn(function MockLogger() {
    return { info };
  })
);

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));
vi.mock('../src/app.js', () => ({ createUploadApp }));
vi.mock('@jibbr/logger', () => ({ Logger }));

describe('upload index entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.PORT = '0';
  });

  it('boots app and starts listening', async () => {
    await import('../src/index.js');
    expect(createUploadApp).toHaveBeenCalled();
    expect(Logger).toHaveBeenCalledWith('upload-service');
    expect(listen).toHaveBeenCalledWith(0, expect.any(Function));
    expect(info).toHaveBeenCalled();
  });
});
