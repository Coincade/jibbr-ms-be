// Simple in-memory rate limiter for WebSocket messages
// For distributed systems, use Redis-based rate limiting

interface RateLimitData {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitData>();

export const checkMessageRateLimit = (userId: string, maxMessages: number = 60, windowMs: number = 60000): boolean => {
  const now = Date.now();
  const userLimit = rateLimitStore.get(userId);

  // No previous limit or window expired
  if (!userLimit || now > userLimit.resetTime) {
    rateLimitStore.set(userId, { count: 1, resetTime: now + windowMs });
    return true;
  }

  // Check if limit exceeded
  if (userLimit.count >= maxMessages) {
    return false;
  }

  // Increment count
  userLimit.count++;
  return true;
};

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [userId, limit] of rateLimitStore.entries()) {
    if (now > limit.resetTime) {
      rateLimitStore.delete(userId);
    }
  }
}, 60000); // Clean every minute

