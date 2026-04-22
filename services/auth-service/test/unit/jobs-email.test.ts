import { afterEach, describe, expect, it, vi } from 'vitest';

const { Queue, Worker, mailHelper } = vi.hoisted(() => ({
  Queue: vi.fn(),
  Worker: vi.fn(),
  mailHelper: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Queue,
  Worker,
}));

vi.mock('../../src/config/queue.js', () => ({
  redisConnection: { fake: true },
  defaultQueueOptions: { attempts: 1 },
}));

vi.mock('../../src/config/mail.js', () => ({
  sendEmail: vi.fn(),
  mailHelper,
}));

describe('jobs/EmailJob and jobs/index', () => {
  afterEach(() => {
    vi.resetModules();
    Queue.mockClear();
    Worker.mockClear();
    mailHelper.mockReset();
  });

  it('registers queue and worker with BullMQ', async () => {
    await import('../../src/jobs/EmailJob.js');
    expect(Queue).toHaveBeenCalledWith(
      'emailQueue',
      expect.objectContaining({
        connection: { fake: true },
        defaultJobOptions: { attempts: 1 },
      }),
    );
    expect(Worker).toHaveBeenCalledWith(
      'emailQueue',
      expect.any(Function),
      expect.objectContaining({
        connection: { fake: true },
      }),
    );
  });

  it('worker processor calls mailHelper with job data', async () => {
    await import('../../src/jobs/EmailJob.js');
    const processor = Worker.mock.calls[0][1] as (job: {
      data: { to: string; subject: string; body: string };
    }) => Promise<void>;
    mailHelper.mockResolvedValue(undefined);
    await processor({
      data: { to: 'a@b.com', subject: 'Hi', body: '<p>x</p>' },
    });
    expect(mailHelper).toHaveBeenCalledWith('a@b.com', 'Hi', '<p>x</p>');
  });

  it('loads jobs entry (re-exports EmailJob side effects)', async () => {
    await import('../../src/jobs/index.js');
    expect(Queue).toHaveBeenCalled();
  });
});
