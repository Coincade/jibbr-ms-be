import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = '/Users/connect/Jibbr/jibbr-ms-be/scripts/check-call-service-health.sh';
const tempDirs: string[] = [];

const makeFakeCurlDir = (scriptBody: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'fake-curl-'));
  const curlPath = join(dir, 'curl');
  writeFileSync(curlPath, `#!/usr/bin/env bash\n${scriptBody}\n`);
  chmodSync(curlPath, 0o755);
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('check-call-service-health.sh', () => {
  it('exits 0 for healthy responses', () => {
    const curlDir = makeFakeCurlDir(`printf '%s' '{"status":"healthy","warnings":[]}'`);

    expect(() =>
      execFileSync('bash', [scriptPath], {
        env: { ...process.env, PATH: `${curlDir}:${process.env.PATH}`, CALL_SERVICE_URL: 'http://fake' },
        encoding: 'utf8',
      })
    ).not.toThrow();
  });

  it('prints hints and still exits 0 for degraded responses', () => {
    const curlDir = makeFakeCurlDir(
      `printf '%s' '{"status":"degraded","warnings":["warn-1"],"turnConfigured":false,"announcedIpConfigured":false}'`
    );

    const result = spawnSync('bash', [scriptPath], {
      env: { ...process.env, PATH: `${curlDir}:${process.env.PATH}`, CALL_SERVICE_URL: 'http://fake' },
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('warning: warn-1');
    expect(result.stderr).toContain('hint: set TURN_URL');
    expect(result.stderr).toContain('hint: set MEDIASOUP_ANNOUNCED_IP');
  });

  it('exits 1 for unhealthy or invalid responses', () => {
    const curlDir = makeFakeCurlDir(`printf '%s' '{"status":"unhealthy"}'`);
    const unhealthy = spawnSync('bash', [scriptPath], {
      env: { ...process.env, PATH: `${curlDir}:${process.env.PATH}`, CALL_SERVICE_URL: 'http://fake' },
      encoding: 'utf8',
    });

    expect(unhealthy.status).toBe(1);
    expect(unhealthy.stderr).toContain('call-service is unhealthy');

    const invalidCurlDir = makeFakeCurlDir(`printf '%s' 'not-json'`);
    const invalid = spawnSync('bash', [scriptPath], {
      env: { ...process.env, PATH: `${invalidCurlDir}:${process.env.PATH}`, CALL_SERVICE_URL: 'http://fake' },
      encoding: 'utf8',
    });

    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain('unexpected health status: invalid');
  });
});
