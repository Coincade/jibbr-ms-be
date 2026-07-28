import { afterEach, describe, expect, it, vi } from 'vitest';

type FakeWorker = {
  pid: number;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  emitDied: () => Promise<void>;
};

const createWorkerMock = vi.fn();

vi.mock('mediasoup', () => ({
  createWorker: createWorkerMock,
}));

const buildWorker = (pid: number): FakeWorker => {
  const handlers = new Map<string, () => Promise<void> | void>();
  return {
    pid,
    close: vi.fn(async () => {}),
    on: vi.fn((event: string, cb: () => Promise<void> | void) => {
      handlers.set(event, cb);
    }),
    emitDied: async () => {
      await handlers.get('died')?.();
    },
  };
};

afterEach(async () => {
  const workersModule = await import('../src/mediasoup/workers.js');
  await workersModule.closeMediasoupWorkers();
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.MEDIASOUP_NUM_WORKERS;
});

describe('mediasoup workers', () => {
  it('prefers the least-loaded worker for new rooms', async () => {
    process.env.MEDIASOUP_NUM_WORKERS = '2';

    const workerA = buildWorker(101);
    const workerB = buildWorker(202);
    createWorkerMock.mockResolvedValueOnce(workerA).mockResolvedValueOnce(workerB);

    const workersModule = await import('../src/mediasoup/workers.js');
    await workersModule.initMediasoupWorkers();

    workersModule.trackRoomOnWorker(101);

    const selected = workersModule.getNextWorker();
    expect(selected.pid).toBe(202);

    const stats = workersModule.getMediasoupWorkerStats();
    expect(stats.roomsByWorker).toEqual({ '101': 1, '202': 0 });
  });

  it('respawns a replacement worker after a worker dies', async () => {
    process.env.MEDIASOUP_NUM_WORKERS = '2';

    const workerA = buildWorker(101);
    const workerB = buildWorker(202);
    const replacement = buildWorker(303);

    createWorkerMock
      .mockResolvedValueOnce(workerA)
      .mockResolvedValueOnce(workerB)
      .mockResolvedValueOnce(replacement);

    const workersModule = await import('../src/mediasoup/workers.js');
    await workersModule.initMediasoupWorkers();
    workersModule.trackRoomOnWorker(101);

    await workerA.emitDied();

    const stats = workersModule.getMediasoupWorkerStats();
    expect(stats.running).toBe(2);
    expect(stats.pids).toEqual(expect.arrayContaining([202, 303]));
    expect(stats.pids).not.toContain(101);
    expect(stats.roomsByWorker).toEqual({ '202': 0, '303': 0 });
  });
});
