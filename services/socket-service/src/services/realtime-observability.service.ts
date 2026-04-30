type CounterKey =
  | 'membership.redis.hit'
  | 'membership.redis.miss'
  | 'membership.redis.error'
  | 'membership.fallback.used'
  | 'membership.fallback.blocked'
  | 'membership.fallback.error'
  | 'rate_limit.allowed'
  | 'rate_limit.blocked'
  | 'rate_limit.redis_error';

const counters = new Map<CounterKey, number>();

const increment = (key: CounterKey) => {
  counters.set(key, (counters.get(key) || 0) + 1);
};

export const realtimeMetrics = {
  increment,
  snapshot: () => {
    const out: Record<string, number> = {};
    for (const [k, v] of counters.entries()) out[k] = v;
    return out;
  },
};

