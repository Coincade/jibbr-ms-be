import { z } from 'zod';

export { shouldNotify, type NotificationPrefsRaw, type NotificationEventMeta } from './notification-preferences';

export {
  DESKTOP_CLIENT_ID,
  MOBILE_CLIENT_ID,
  WEB_CLIENT_ID,
  KNOWN_CLIENT_IDS,
  CLIENT_VERSION_UNSUPPORTED,
  WS_CLIENT_VERSION_UNSUPPORTED,
  WS_CLOSE_CODE_UNSUPPORTED,
  HTTP_STATUS_CLIENT_UNSUPPORTED,
  HEADER_CLIENT,
  HEADER_VERSION,
  HEADER_PLATFORM,
  HEADER_ARCH,
  sanitizeClientMeta,
  parseDesktopSemver,
  getClientVersionPolicy,
  getDesktopVersionPolicy,
  evaluateClientVersion,
  evaluateDesktopVersion,
  parseJibbrClientId,
  isDesktopClientName,
  parseDesktopClientHeaders,
  parseDesktopClientFromRecord,
  parseDesktopClientFromRequestUrl,
  mergeDesktopClientMeta,
  shouldRejectDesktopClient,
  buildUnsupportedHttpBody,
  buildUnsupportedWsPayload,
  toVersionStatusResponse,
  type JibbrClientId,
  type DesktopVersionPolicy,
  type DesktopVersionEvaluation,
  type DesktopClientMeta,
  type DesktopUnsupportedErrorBody,
} from './desktop-version';

export {
  createDesktopVersionMiddleware,
  handleDesktopVersionStatus,
  type LocalsDesktopVersion,
} from './desktop-version-http';

export {
  setDesktopVersionTelemetryRedis,
  resetDesktopVersionTelemetryForTests,
  recordDesktopClientSeen,
  getDesktopVersionStats,
  type DesktopVersionSeen,
  type DesktopVersionStats,
} from './desktop-version-telemetry';

// Validation utility
export function validateRequest<T>(schema: z.ZodSchema<T>, data: unknown): T {
  return schema.parse(data);
}

// HTTP Client for inter-service communication
export class HttpClient {
  constructor(
    private baseURL: string,
    private defaultHeaders?: Record<string, string>
  ) {}

  async get<T>(path: string, headers?: Record<string, string>): Promise<T> {
    const response = await fetch(`${this.baseURL}${path}`, {
      headers: { ...this.defaultHeaders, ...headers },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = (await response.json()) as T;
    return data;
  }

  async post<T>(
    path: string,
    body: unknown,
    headers?: Record<string, string>
  ): Promise<T> {
    const response = await fetch(`${this.baseURL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.defaultHeaders,
        ...headers,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = (await response.json()) as T;
    return data;
  }

  async put<T>(
    path: string,
    body: unknown,
    headers?: Record<string, string>
  ): Promise<T> {
    const response = await fetch(`${this.baseURL}${path}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...this.defaultHeaders,
        ...headers,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = (await response.json()) as T;
    return data;
  }

  async delete<T>(path: string, headers?: Record<string, string>): Promise<T> {
    const response = await fetch(`${this.baseURL}${path}`, {
      method: 'DELETE',
      headers: { ...this.defaultHeaders, ...headers },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = (await response.json()) as T;
    return data;
  }
}

// Retry utility with exponential backoff
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delay = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, delay * Math.pow(2, i))
      );
    }
  }
  throw new Error('Max retries exceeded');
}

