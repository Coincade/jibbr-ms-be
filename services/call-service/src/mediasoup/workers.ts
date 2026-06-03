import * as mediasoup from 'mediasoup';
import type { Worker } from 'mediasoup/node/lib/types.js';
import { workerSettings } from '../config/mediasoup.js';

let workers: Worker[] = [];
let nextWorkerIdx = 0;

/** Called by rooms.ts when a worker dies so affected rooms can be closed. */
export let onWorkerDied: ((workerId: number) => Promise<void>) | null = null;
export const setOnWorkerDied = (cb: (workerId: number) => Promise<void>) => {
  onWorkerDied = cb;
};

const spawnWorker = async (): Promise<Worker> => {
  const worker = await mediasoup.createWorker(workerSettings);

  worker.on('died', async () => {
    console.error(`[mediasoup] Worker ${worker.pid} died — closing affected rooms and respawning`);

    // Remove the dead worker from the pool immediately
    workers = workers.filter((w) => w !== worker);
    // Sanitise round-robin index
    if (nextWorkerIdx >= workers.length) nextWorkerIdx = 0;

    // Notify rooms module so it can close rooms hosted on this worker
    try {
      if (onWorkerDied) await onWorkerDied(worker.pid);
    } catch (e) {
      console.error('[mediasoup] Error closing rooms for dead worker:', e);
    }

    // Respawn a replacement worker
    try {
      const replacement = await spawnWorker();
      workers.push(replacement);
      console.log(`[mediasoup] Replacement worker spawned (pid ${replacement.pid}), pool size: ${workers.length}`);
    } catch (e) {
      console.error('[mediasoup] Failed to respawn worker:', e);
    }
  });

  return worker;
};

export const initMediasoupWorkers = async (): Promise<void> => {
  const numWorkers = Number.parseInt(process.env.MEDIASOUP_NUM_WORKERS || '1', 10);
  workers = await Promise.all(Array.from({ length: numWorkers }, spawnWorker));
  console.log(`[mediasoup] ${workers.length} worker(s) started`);
};

export const getNextWorker = (): Worker => {
  if (workers.length === 0) throw new Error('[mediasoup] No workers available');
  const worker = workers[nextWorkerIdx % workers.length];
  nextWorkerIdx = (nextWorkerIdx + 1) % workers.length;
  return worker;
};

/** Expose worker pid so rooms can track which worker owns their router. */
export const getWorkerPid = (worker: Worker): number => worker.pid;

export const closeMediasoupWorkers = async (): Promise<void> => {
  await Promise.all(workers.map((w) => w.close()));
  workers = [];
};
