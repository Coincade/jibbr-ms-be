import * as mediasoup from 'mediasoup';
import type { Worker } from 'mediasoup/types';
import { cpus } from 'os';
import { workerSettings } from '../config/mediasoup.js';

let workers: Worker[] = [];
let nextWorkerIdx = 0;

/** roomId → worker pid — kept in sync by rooms.ts for least-loaded scheduling. */
const roomCountByWorkerPid = new Map<number, number>();

/** Called by rooms.ts when a worker dies so affected rooms can be closed. */
export let onWorkerDied: ((workerId: number) => Promise<void>) | null = null;
export const setOnWorkerDied = (cb: (workerId: number) => Promise<void>) => {
  onWorkerDied = cb;
};

export const trackRoomOnWorker = (workerPid: number): void => {
  roomCountByWorkerPid.set(workerPid, (roomCountByWorkerPid.get(workerPid) ?? 0) + 1);
};

export const untrackRoomOnWorker = (workerPid: number): void => {
  const current = roomCountByWorkerPid.get(workerPid) ?? 0;
  if (current <= 1) roomCountByWorkerPid.delete(workerPid);
  else roomCountByWorkerPid.set(workerPid, current - 1);
};

export const clearRoomsForWorker = (workerPid: number): void => {
  roomCountByWorkerPid.delete(workerPid);
};

const defaultWorkerCount = (): number => {
  const fromEnv = Number.parseInt(process.env.MEDIASOUP_NUM_WORKERS || '', 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  // Leave one core for Node/event loop; cap at 4 for a typical single droplet.
  return Math.min(4, Math.max(1, cpus().length - 1));
};

const spawnWorker = async (): Promise<Worker> => {
  const worker = await mediasoup.createWorker(workerSettings);

  worker.on('died', async () => {
    console.error(`[mediasoup] Worker ${worker.pid} died — closing affected rooms and respawning`);

    workers = workers.filter((w) => w !== worker);
    clearRoomsForWorker(worker.pid);
    if (nextWorkerIdx >= workers.length) nextWorkerIdx = 0;

    try {
      if (onWorkerDied) await onWorkerDied(worker.pid);
    } catch (e) {
      console.error('[mediasoup] Error closing rooms for dead worker:', e);
    }

    try {
      const replacement = await spawnWorker();
      workers.push(replacement);
      console.log(
        `[mediasoup] Replacement worker spawned (pid ${replacement.pid}), pool size: ${workers.length}`
      );
    } catch (e) {
      console.error('[mediasoup] Failed to respawn worker:', e);
    }
  });

  return worker;
};

export const initMediasoupWorkers = async (): Promise<void> => {
  const numWorkers = defaultWorkerCount();
  workers = await Promise.all(Array.from({ length: numWorkers }, spawnWorker));
  console.log(`[mediasoup] ${workers.length} worker(s) started (least-loaded room assignment)`);
};

/** Prefer the worker hosting the fewest rooms (falls back to round-robin). */
export const getNextWorker = (): Worker => {
  if (workers.length === 0) throw new Error('[mediasoup] No workers available');
  if (workers.length === 1) return workers[0];

  let best = workers[0];
  let bestCount = roomCountByWorkerPid.get(best.pid) ?? 0;
  for (let i = 1; i < workers.length; i++) {
    const w = workers[i];
    const count = roomCountByWorkerPid.get(w.pid) ?? 0;
    if (count < bestCount) {
      best = w;
      bestCount = count;
    }
  }

  // Mild round-robin tie-break so identical loads rotate.
  if ((roomCountByWorkerPid.get(workers[nextWorkerIdx % workers.length]?.pid) ?? 0) === bestCount) {
    const rr = workers[nextWorkerIdx % workers.length];
    nextWorkerIdx = (nextWorkerIdx + 1) % workers.length;
    return rr;
  }

  return best;
};

/** Expose worker pid so rooms can track which worker owns their router. */
export const getWorkerPid = (worker: Worker): number => worker.pid;

export const getMediasoupWorkerStats = (): {
  expected: number;
  running: number;
  pids: number[];
  roomsByWorker: Record<string, number>;
} => {
  const expected = defaultWorkerCount();
  const roomsByWorker: Record<string, number> = {};
  for (const w of workers) {
    roomsByWorker[String(w.pid)] = roomCountByWorkerPid.get(w.pid) ?? 0;
  }
  return {
    expected,
    running: workers.length,
    pids: workers.map((w) => w.pid),
    roomsByWorker,
  };
};

export const closeMediasoupWorkers = async (): Promise<void> => {
  await Promise.all(workers.map((w) => w.close()));
  workers = [];
  roomCountByWorkerPid.clear();
};
