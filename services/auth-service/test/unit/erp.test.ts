import { describe, expect, it } from 'vitest';
import {
  accessNeedsRefresh,
  beginConnect,
  buildAuthorizeUrl,
  completeCallback,
  disconnectErp,
  forwardAsk,
  newOauthState,
  parseWhoami,
  publicStatus,
  sanitizeAskBody,
  type ErpConfig,
  type ErpLinkRecord,
  type ErpRepository,
} from '../../src/erp/erp.js';

const config: ErpConfig = {
  clientId: 'client',
  clientSecret: 'secret',
  baseUrl: 'http://192.168.1.15:8001',
  redirectUri: 'http://localhost:3000/erp/callback',
};

function memoryRepo(): ErpRepository & { rows: Map<string, ErpLinkRecord> } {
  const rows = new Map<string, ErpLinkRecord>();
  return {
    rows,
    async findByUser(userId) {
      return rows.get(userId) ?? null;
    },
    async findByState(state) {
      return [...rows.values()].find((row) => row.oauthState === state) ?? null;
    },
    async upsertPending(userId, state, expiresAt) {
      const current = rows.get(userId);
      rows.set(userId, {
        userId,
        accessToken: current?.accessToken ?? null,
        refreshToken: current?.refreshToken ?? null,
        accessExpiresAt: current?.accessExpiresAt ?? null,
        employeeExternalId: current?.employeeExternalId ?? null,
        employeeName: current?.employeeName ?? null,
        roleId: current?.roleId ?? null,
        roleName: current?.roleName ?? null,
        oauthState: state,
        oauthStateExpiresAt: expiresAt,
      });
    },
    async saveConnection(userId, connection) {
      rows.set(userId, {
        userId,
        accessToken: connection.accessToken,
        refreshToken: connection.refreshToken,
        accessExpiresAt: connection.accessExpiresAt,
        employeeExternalId: connection.employeeExternalId,
        employeeName: connection.employeeName,
        roleId: connection.roleId,
        roleName: connection.roleName,
        oauthState: null,
        oauthStateExpiresAt: null,
      });
    },
    async clearState(userId) {
      const current = rows.get(userId);
      if (!current) return;
      rows.set(userId, { ...current, oauthState: null, oauthStateExpiresAt: null });
    },
    async deleteByUser(userId) {
      rows.delete(userId);
    },
    async updateTokens(userId, tokens) {
      const current = rows.get(userId);
      if (!current) return;
      rows.set(userId, { ...current, ...tokens });
    },
  };
}

describe('ERP connect', () => {
  it('builds the consent URL with the registered callback', () => {
    const url = new URL(buildAuthorizeUrl(config, 'state-value-with-enough-length'));
    expect(url.origin + url.pathname).toBe('http://192.168.1.15:8001/app/login/oauth2/authorize.nl');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('client');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/erp/callback');
    expect(url.searchParams.get('scope')).toBe('rest_webservices');
    expect(url.searchParams.get('state')).toBe('state-value-with-enough-length');
  });

  it('creates a state long enough for the consent page', () => {
    const state = newOauthState();
    expect(state.length).toBeGreaterThanOrEqual(22);
    expect(state.length).toBeLessThanOrEqual(1024);
  });

  it('reads the ERP employee without comparing it to a Jibbr profile', () => {
    expect(parseWhoami({
      role: { id: '1002', name: 'Sales' },
      employee: { externalId: 'HL0042', firstName: 'Aarav', lastName: 'Iyer', email: 'aarav.iyer@hirect.com' },
    })).toEqual({
      employeeExternalId: 'HL0042',
      employeeName: 'Aarav Iyer',
      roleId: '1002',
      roleName: 'Sales',
    });
  });

  it('keeps the ERP token off the status response', async () => {
    const repo = memoryRepo();
    const url = await beginConnect('user-1', repo, config);
    const state = new URL(url).searchParams.get('state') ?? '';
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = String(input);
      if (target.endsWith('/token')) {
        expect(String(init?.headers && (init.headers as Record<string, string>).Authorization)).toMatch(/^Basic /);
        expect(String(init?.body)).toContain('grant_type=authorization_code');
        return new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }), { status: 200 });
      }
      expect(String((init?.headers as Record<string, string>).Authorization)).toBe('Bearer access');
      return new Response(JSON.stringify({
        role: { id: '1002', name: 'Sales' },
        employee: { externalId: 'HL0042', firstName: 'Aarav', lastName: 'Iyer' },
      }), { status: 200 });
    }) as typeof fetch;

    const done = await completeCallback({ code: 'CODE', state }, repo, config, fetchImpl);
    expect(done.status).toBe(200);
    expect(done.html).toContain('Aarav Iyer');
    expect(done.html).not.toContain('access');
    expect(publicStatus(await repo.findByUser('user-1'))).toEqual({
      connected: true,
      employeeName: 'Aarav Iyer',
      employeeExternalId: 'HL0042',
      roleName: 'Sales',
    });
  });

  it('discards a callback whose state was not issued here', async () => {
    const repo = memoryRepo();
    const done = await completeCallback({ code: 'CODE', state: 'nope' }, repo, config);
    expect(done.status).toBe(400);
    expect(repo.rows.size).toBe(0);
  });

  it('revokes the refresh token on disconnect and leaves no local link', async () => {
    const repo = memoryRepo();
    repo.rows.set('user-1', {
      userId: 'user-1',
      accessToken: 'access',
      refreshToken: 'refresh',
      accessExpiresAt: new Date('2026-11-18T12:00:00Z'),
      employeeExternalId: 'HL0042',
      employeeName: 'Aarav Iyer',
      roleId: '1002',
      roleName: 'Sales',
      oauthState: null,
      oauthStateExpiresAt: null,
    });
    let revoked = '';
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      revoked = String(init?.body);
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    await disconnectErp('user-1', repo, config, fetchImpl);
    expect(revoked).toContain('token=refresh');
    expect(await repo.findByUser('user-1')).toBeNull();
  });
});

function linked(expiresAt: Date): ErpLinkRecord {
  return {
    userId: 'user-1',
    accessToken: 'erp-access',
    refreshToken: 'erp-refresh',
    accessExpiresAt: expiresAt,
    employeeExternalId: 'HL0042',
    employeeName: 'Manoj Choudhary',
    roleId: '1000',
    roleName: 'Employee',
    oauthState: null,
    oauthStateExpiresAt: null,
  };
}

function sse(status: '' | 'connect', answer = 'Manoj can see this.'): string {
  return [
    `event: token\ndata: ${JSON.stringify({ text: answer })}\n\n`,
    `event: done\ndata: ${JSON.stringify({ route: 'employees', erp_status: status, cached: false })}\n\n`,
  ].join('');
}

describe('ERP ask forward', () => {
  const now = new Date('2026-11-18T06:00:00Z');
  const later = new Date('2026-11-18T08:00:00Z');

  it('refreshes inside one minute of expiry and not before', () => {
    expect(accessNeedsRefresh(new Date(now.getTime() + 30_000), now)).toBe(true);
    expect(accessNeedsRefresh(null, now)).toBe(true);
    expect(accessNeedsRefresh(later, now)).toBe(false);
  });

  it('keeps only the ask fields', () => {
    expect(sanitizeAskBody({
      question: 'who is vikram?',
      history: [{ role: 'user', content: 'earlier', extra: true }, { role: 'nope', content: 'x' }],
      conversation_id: 'chat-1',
      attachment_ids: ['a', 'b', 'c', 'd', 'e', 'f'],
      authorization: 'Bearer jibbr',
    })).toEqual({
      ok: true,
      body: {
        question: 'who is vikram?',
        history: [{ role: 'user', content: 'earlier' }],
        conversation_id: 'chat-1',
        attachment_ids: ['b', 'c', 'd', 'e', 'f'],
      },
    });
  });

  it('sends the ERP access token to Local Rag and not the Jibbr session', async () => {
    const repo = memoryRepo();
    repo.rows.set('user-1', linked(later));
    const calls: { url: string; authorization: string | null; bypass: string | null }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(input),
        authorization: headers.get('Authorization'),
        bypass: headers.get('X-Bypass-Cache'),
      });
      return new Response(sse(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }) as typeof fetch;

    const result = await forwardAsk({
      userId: 'user-1',
      repo,
      config,
      ragBase: 'http://192.168.1.15:8000',
      body: { question: 'who is vikram?', history: [] },
      bypassCache: false,
      fetchImpl,
      now,
    });

    expect(calls).toEqual([{
      url: 'http://192.168.1.15:8000/api/ask/stream',
      authorization: 'Bearer erp-access',
      bypass: null,
    }]);
    expect(result.disconnected).toBe(false);
    expect(result.body).not.toContain('erp-access');
    expect(result.body).not.toContain('jibbr');
  });

  it('forwards a question with no ERP link and no bearer', async () => {
    const repo = memoryRepo();
    let authorization: string | null = 'set';
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get('Authorization');
      return new Response(sse('connect', 'Connect HIRECT ERP.'), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as typeof fetch;
    const result = await forwardAsk({
      userId: 'user-1',
      repo,
      config,
      ragBase: 'http://192.168.1.15:8000',
      body: { question: 'what is the leave policy?', history: [] },
      bypassCache: false,
      fetchImpl,
      now,
    });
    expect(authorization).toBeNull();
    expect(result.disconnected).toBe(false);
    expect(result.body).toContain('Connect HIRECT ERP.');
  });

  it('refreshes once when Local Rag asks to connect, then retries with the new token', async () => {
    const repo = memoryRepo();
    repo.rows.set('user-1', linked(later));
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push(`${url} ${headers.get('Authorization') ?? ''} ${headers.get('X-Bypass-Cache') ?? ''}`);
      if (url.endsWith('/token')) {
        expect(String(init?.body)).toContain('grant_type=refresh_token');
        expect(String(init?.body)).toContain('refresh_token=erp-refresh');
        return new Response(JSON.stringify({ access_token: 'erp-new', refresh_token: 'erp-refresh-2', expires_in: 3600 }), { status: 200 });
      }
      const answer = headers.get('Authorization') === 'Bearer erp-new' ? sse('') : sse('connect', 'Connect HIRECT ERP.');
      return new Response(answer, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }) as typeof fetch;

    const result = await forwardAsk({
      userId: 'user-1',
      repo,
      config,
      ragBase: 'http://192.168.1.15:8000',
      body: { question: 'who is vikram?', history: [] },
      bypassCache: false,
      fetchImpl,
      now,
    });

    expect(calls.map((call) => call.includes('/token'))).toEqual([false, true, false]);
    expect(calls[2]).toContain('Bearer erp-new');
    expect(calls[2]).toContain(' 1');
    expect(result.body).toContain('Manoj can see this.');
    expect(result.disconnected).toBe(false);
    expect((await repo.findByUser('user-1'))?.accessToken).toBe('erp-new');
  });

  it('deletes the link when the refresh fails and still returns the first answer', async () => {
    const repo = memoryRepo();
    repo.rows.set('user-1', linked(later));
    let ragCalls = 0;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/token')) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
      ragCalls += 1;
      return new Response(sse('connect', 'Connect HIRECT ERP.'), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as typeof fetch;
    const result = await forwardAsk({
      userId: 'user-1',
      repo,
      config,
      ragBase: 'http://192.168.1.15:8000',
      body: { question: 'who is vikram?', history: [] },
      bypassCache: true,
      fetchImpl,
      now,
    });
    expect(ragCalls).toBe(1);
    expect(result.disconnected).toBe(true);
    expect(result.body).toContain('Connect HIRECT ERP.');
    expect(await repo.findByUser('user-1')).toBeNull();
  });
});
