import { createJwtOrIpRateLimiter } from '@jibbr/rate-limit';

export const appLimiter = createJwtOrIpRateLimiter();
