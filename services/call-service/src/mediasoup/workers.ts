import * as mediasoup from 'mediasoup';
import type { Worker } from 'mediasoup/node/lib/types.js';
import { workerSettings } from '../config/mediasoup.js';

let workers: Worker[] = [];
let nextWorkerIdx = 0;

export const initMediasoupWorkers = async (): Promise<void> => {
  const numWorkers = Number.parseInt(process.env.MEDIASOUP_NUM_WORKERS || '1', 10);

  workers = await Promise.all(
    Array.from({ length: numWorkers }, async () => {
      const worker = await mediasoup.createWorker(workerSettings);
      worker.on('died', () => {
        console.error('[mediasoup] Worker died, exiting in 2s...');
        setTimeout(() => process.exit(1), 2000);
      });
      return worker;
    })
  );

  console.log(`[mediasoup] ${workers.length} worker(s) started`);
};

export const getNextWorker = (): Worker => {
  const worker = workers[nextWorkerIdx];
  nextWorkerIdx = (nextWorkerIdx + 1) % workers.length;
  return worker;
};

export const closeMediasoupWorkers = async (): Promise<void> => {
  await Promise.all(workers.map((w) => w.close()));
  workers = [];
};
