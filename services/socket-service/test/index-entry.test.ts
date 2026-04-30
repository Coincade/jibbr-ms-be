import { beforeEach, describe, expect, it, vi } from 'vitest';

const use = vi.hoisted(() => vi.fn());
const listen = vi.hoisted(() =>
  vi.fn((...args: unknown[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') cb();
  })
);
const createServer = vi.hoisted(() => vi.fn(() => ({ listen })));
const createSocketApp = vi.hoisted(() => vi.fn(() => ({ use })));
const initializeWebSocketService = vi.hoisted(() => vi.fn(async () => undefined));
const info = vi.hoisted(() => vi.fn());
const error = vi.hoisted(() => vi.fn());

vi.mock('dotenv', () => ({ default: { config: vi.fn(() => ({})) } }));
vi.mock('http', () => ({ createServer }));
vi.mock('../src/app.js', () => ({ createSocketApp }));
vi.mock('../src/websocket/index.js', () => ({ initializeWebSocketService }));
vi.mock('../src/routes/presence.route.js', () => ({ default: { _route: 'presence' } }));
vi.mock('@jibbr/logger', () => ({
  Logger: vi.fn(function Logger() {
    return { info, error };
  }),
}));

describe('index entry', () => {
  const eventually = async (assertion: () => void, retries = 20, delayMs = 10) => {
    for (let i = 0; i < retries; i += 1) {
      try {
        assertion();
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    assertion();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.PORT = '0';
  });

  it('initializes websocket service and starts listening', async () => {
    await import('../src/index.js');
    await eventually(() => {
      expect(initializeWebSocketService).toHaveBeenCalled();
    });
    expect(createSocketApp).toHaveBeenCalled();
    expect(use).toHaveBeenCalled();
    expect(listen).toHaveBeenCalledWith('0', expect.any(Function));
    expect(info).toHaveBeenCalled();
  });
});
