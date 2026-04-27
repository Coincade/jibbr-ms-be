const RETRY_DELAYS_MS = [100, 300, 1000, 3000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withJitter = (delayMs: number): number => {
  const jitter = Math.floor(Math.random() * 50);
  return delayMs + jitter;
};

export const retryWithBackoff = async <T>(
  operation: () => Promise<T>,
  options: {
    retries?: number;
    shouldRetry?: (error: unknown) => boolean;
  } = {}
): Promise<T> => {
  const retries = options.retries ?? RETRY_DELAYS_MS.length;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      if (options.shouldRetry && !options.shouldRetry(error)) break;
      await sleep(withJitter(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]));
    }
  }

  throw lastError;
};

