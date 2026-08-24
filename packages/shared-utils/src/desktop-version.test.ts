import { afterEach, describe, expect, it } from 'vitest';
import {
  buildUnsupportedHttpBody,
  evaluateClientVersion,
  evaluateDesktopVersion,
  getClientVersionPolicy,
  parseDesktopSemver,
  shouldRejectDesktopClient,
  type DesktopVersionPolicy,
} from './desktop-version';
import { createDesktopVersionMiddleware, handleDesktopVersionStatus } from './desktop-version-http';
import { getDesktopVersionStats, recordDesktopClientSeen, resetDesktopVersionTelemetryForTests } from './desktop-version-telemetry';

const policy = (overrides?: Partial<DesktopVersionPolicy>): DesktopVersionPolicy => ({
  latestVersion: '0.1.1',
  minimumSupportedVersion: '0.1.0',
  updateUrl: '',
  forceUpdate: false,
  requireVersion: false,
  ...overrides,
});

afterEach(() => {
  resetDesktopVersionTelemetryForTests();
  for (const prefix of ['JIBBR_DESKTOP', 'JIBBR_MOBILE', 'JIBBR_WEB'] as const) {
    delete process.env[`${prefix}_LATEST_VERSION`];
    delete process.env[`${prefix}_MIN_VERSION`];
    delete process.env[`${prefix}_FORCE_UPDATE`];
    delete process.env[`${prefix}_REQUIRE_VERSION`];
    delete process.env[`${prefix}_UPDATE_URL`];
  }
});

describe('evaluateDesktopVersion', () => {
  it('Case A: current equals latest and is above min', () => {
    const result = evaluateDesktopVersion('0.1.1', policy({ latestVersion: '0.1.1', minimumSupportedVersion: '0.1.0' }));
    expect(result.supported).toBe(true);
    expect(result.updateAvailable).toBe(false);
    expect(result.updateRequired).toBe(false);
  });

  it('Case B: current is min but behind latest', () => {
    const result = evaluateDesktopVersion('0.1.0', policy({ latestVersion: '0.1.1', minimumSupportedVersion: '0.1.0' }));
    expect(result.supported).toBe(true);
    expect(result.updateAvailable).toBe(true);
    expect(result.updateRequired).toBe(false);
  });

  it('Case C: current below min', () => {
    const result = evaluateDesktopVersion('0.0.9', policy({ latestVersion: '0.1.1', minimumSupportedVersion: '0.1.0' }));
    expect(result.supported).toBe(false);
    expect(result.updateAvailable).toBe(true);
    expect(result.updateRequired).toBe(true);
  });

  it('Case D: current equals latest and min', () => {
    const result = evaluateDesktopVersion('0.1.2', policy({ latestVersion: '0.1.2', minimumSupportedVersion: '0.1.2' }));
    expect(result.supported).toBe(true);
    expect(result.updateAvailable).toBe(false);
    expect(result.updateRequired).toBe(false);
  });

  it('Case E: malformed version does not throw and is not blocked in phase 1', () => {
    expect(parseDesktopSemver('hello-world')).toBeNull();
    const result = evaluateDesktopVersion('hello-world', policy());
    expect(result.malformed).toBe(true);
    expect(result.supported).toBe(true);
    expect(result.updateRequired).toBe(false);
    expect(shouldRejectDesktopClient(result, policy())).toBe(false);
  });

  it('missing version is not blocked unless requireVersion is set', () => {
    const result = evaluateDesktopVersion(null, policy());
    expect(result.missingVersion).toBe(true);
    expect(result.supported).toBe(true);
    expect(shouldRejectDesktopClient(result, policy({ requireVersion: true }))).toBe(true);
  });
});

describe('HTTP middleware', () => {
  const run = (headers: Record<string, string>, path = '/api/messages') => {
    const middleware = createDesktopVersionMiddleware();
    let statusCode = 200;
    let body: unknown = null;
    let nextCalled = false;
    const req = { headers, path };
    const res = {
      locals: {} as Record<string, unknown>,
      status(code: number) {
        statusCode = code;
        return {
          json(payload: unknown) {
            body = payload;
            return payload;
          },
        };
      },
      json(payload: unknown) {
        body = payload;
        return payload;
      },
    };
    middleware(req, res, () => {
      nextCalled = true;
    });
    return { statusCode, body, nextCalled, locals: res.locals };
  };

  it('Case F: web client without Electron headers is not blocked', () => {
    process.env.JIBBR_DESKTOP_LATEST_VERSION = '0.1.1';
    process.env.JIBBR_DESKTOP_MIN_VERSION = '0.1.0';
    const result = run({ origin: 'https://jibbr.in' });
    expect(result.nextCalled).toBe(true);
    expect(result.statusCode).toBe(200);
  });

  it('blocks identified desktop clients below minimum', () => {
    process.env.JIBBR_DESKTOP_LATEST_VERSION = '0.1.1';
    process.env.JIBBR_DESKTOP_MIN_VERSION = '0.1.0';
    const result = run({
      'x-jibbr-client': 'desktop',
      'x-jibbr-version': '0.0.9',
      'x-jibbr-platform': 'darwin',
    });
    expect(result.nextCalled).toBe(false);
    expect(result.statusCode).toBe(426);
    expect((result.body as { error: { code: string } }).error.code).toBe('CLIENT_VERSION_UNSUPPORTED');
  });

  it('allows supported older desktop clients', () => {
    process.env.JIBBR_DESKTOP_LATEST_VERSION = '0.1.1';
    process.env.JIBBR_DESKTOP_MIN_VERSION = '0.1.0';
    const result = run({
      'x-jibbr-client': 'desktop',
      'x-jibbr-version': '0.1.0',
    });
    expect(result.nextCalled).toBe(true);
  });

  it('uses independent mobile policy (not desktop min)', () => {
    process.env.JIBBR_DESKTOP_MIN_VERSION = '0.1.0';
    process.env.JIBBR_MOBILE_LATEST_VERSION = '1.0.0';
    process.env.JIBBR_MOBILE_MIN_VERSION = '1.0.0';
    const allowed = run({
      'x-jibbr-client': 'mobile',
      'x-jibbr-version': '1.0.0',
    });
    expect(allowed.nextCalled).toBe(true);

    const blocked = run({
      'x-jibbr-client': 'mobile',
      'x-jibbr-version': '0.9.0',
    });
    expect(blocked.nextCalled).toBe(false);
    expect(blocked.statusCode).toBe(426);
  });

  it('uses independent web policy defaults', () => {
    const result = run({
      'x-jibbr-client': 'web',
      'x-jibbr-version': '0.0.0',
    });
    expect(result.nextCalled).toBe(true);
    expect(getClientVersionPolicy('web').minimumSupportedVersion).toBe('0.0.0');
  });

  it('evaluateClientVersion respects client-specific env', () => {
    process.env.JIBBR_WEB_LATEST_VERSION = '0.2.0';
    process.env.JIBBR_WEB_MIN_VERSION = '0.1.0';
    const result = evaluateClientVersion('web', '0.0.5');
    expect(result.updateRequired).toBe(true);
    expect(result.latestVersion).toBe('0.2.0');
  });

  it('426 body uses the identified client update URL, not desktop', () => {
    process.env.JIBBR_MOBILE_LATEST_VERSION = '1.1.0';
    process.env.JIBBR_MOBILE_MIN_VERSION = '1.1.0';
    process.env.JIBBR_MOBILE_UPDATE_URL = 'https://example.com/mobile';
    process.env.JIBBR_DESKTOP_UPDATE_URL = 'https://example.com/desktop';
    const evaluation = evaluateClientVersion('mobile', '1.0.0');
    const body = buildUnsupportedHttpBody(evaluation);
    expect(body.error.updateUrl).toBe('https://example.com/mobile');
    expect(body.error.minimumSupportedVersion).toBe('1.1.0');
  });

  it('does not block version-status for unsupported clients', () => {
    process.env.JIBBR_DESKTOP_LATEST_VERSION = '0.1.1';
    process.env.JIBBR_DESKTOP_MIN_VERSION = '0.1.0';
    const middleware = createDesktopVersionMiddleware();
    let nextCalled = false;
    middleware(
      {
        path: '/api/client/version-status',
        headers: { 'x-jibbr-client': 'desktop', 'x-jibbr-version': '0.0.9' },
      },
      { locals: {}, status: () => ({ json: () => undefined }), json: () => undefined },
      () => {
        nextCalled = true;
      }
    );
    expect(nextCalled).toBe(true);

    let body: unknown;
    handleDesktopVersionStatus(
      { headers: { 'x-jibbr-client': 'desktop', 'x-jibbr-version': '0.0.9' } },
      {
        status: () => ({
          json: (payload: unknown) => {
            body = payload;
            return payload;
          },
        }),
        json: (payload: unknown) => {
          body = payload;
          return payload;
        },
      }
    );
    expect(body).toMatchObject({
      supported: false,
      updateRequired: true,
      currentVersion: '0.0.9',
    });
  });
});

describe('telemetry', () => {
  it('aggregates unique users by version', async () => {
    await recordDesktopClientSeen('u1', { client: 'desktop', version: '0.1.1', platform: 'darwin', arch: 'arm64' });
    await recordDesktopClientSeen('u2', { client: 'desktop', version: '0.1.0', platform: 'win32', arch: 'x64' });
    await recordDesktopClientSeen('u1', { client: 'desktop', version: '0.1.1', platform: 'darwin', arch: 'arm64' });
    const stats = await getDesktopVersionStats();
    expect(stats.versions).toEqual(
      expect.arrayContaining([
        { version: '0.1.1', activeUsers: 1 },
        { version: '0.1.0', activeUsers: 1 },
      ])
    );
  });
});
