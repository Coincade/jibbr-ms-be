import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('retryWithBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries until the operation succeeds', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'))
      .mockResolvedValueOnce('ok');

    const { retryWithBackoff } = await import('../src/libs/retry.js');
    const pending = retryWithBackoff(operation, { retries: 3 });
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('stops retrying when shouldRetry returns false', async () => {
    const operation = vi.fn().mockImplementation(async () => {
      throw new Error('fatal');
    });

    const { retryWithBackoff } = await import('../src/libs/retry.js');
    await expect(
      retryWithBackoff(operation, {
        retries: 3,
        shouldRetry: () => false,
      })
    ).rejects.toThrow('fatal');
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
