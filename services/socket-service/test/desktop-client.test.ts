import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyDesktopMeta,
  extractDesktopMetaFromFrame,
  extractDesktopMetaFromUpgradeUrl,
  rejectUnsupportedDesktopWs,
} from '../src/websocket/desktop-client.js';

afterEach(() => {
  delete process.env.JIBBR_DESKTOP_LATEST_VERSION;
  delete process.env.JIBBR_DESKTOP_MIN_VERSION;
  delete process.env.JIBBR_DESKTOP_REQUIRE_VERSION;
});

describe('desktop websocket handshake', () => {
  it('Case H: supported older client is not rejected', () => {
    process.env.JIBBR_DESKTOP_LATEST_VERSION = '0.1.1';
    process.env.JIBBR_DESKTOP_MIN_VERSION = '0.1.0';
    const meta = extractDesktopMetaFromUpgradeUrl('/ws?client=desktop&version=0.1.0&platform=darwin&arch=arm64');
    const ws = {
      OPEN: 1,
      CONNECTING: 0,
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
    };
    expect(rejectUnsupportedDesktopWs(ws as any, meta, 'user-1')).toBe(false);
    expect(ws.close).not.toHaveBeenCalled();
  });

  it('Case G: unsupported client receives event and close 4403', () => {
    process.env.JIBBR_DESKTOP_LATEST_VERSION = '0.1.1';
    process.env.JIBBR_DESKTOP_MIN_VERSION = '0.1.0';
    const meta = extractDesktopMetaFromFrame({
      type: 'client_info',
      data: { type: 'client_info', client: 'desktop', version: '0.0.9', platform: 'win32', arch: 'x64' },
    });
    const ws = {
      OPEN: 1,
      CONNECTING: 0,
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
    };
    expect(rejectUnsupportedDesktopWs(ws as any, meta, 'user-old')).toBe(true);
    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('client_version_unsupported'));
    expect(ws.close).toHaveBeenCalledWith(4403, 'client_version_unsupported');
  });

  it('merges query and auth-frame metadata', () => {
    const fromUrl = extractDesktopMetaFromUpgradeUrl('/ws?client=desktop&version=0.1.0');
    const fromAuth = extractDesktopMetaFromFrame({
      type: 'auth',
      data: { type: 'auth', token: 'x', client: 'desktop', platform: 'linux', arch: 'x64' },
    });
    const merged = applyDesktopMeta(fromUrl, fromAuth);
    expect(merged).toMatchObject({
      client: 'desktop',
      version: '0.1.0',
      platform: 'linux',
      arch: 'x64',
    });
  });
});
