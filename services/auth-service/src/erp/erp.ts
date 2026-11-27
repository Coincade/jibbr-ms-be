import { randomBytes } from 'crypto';

const STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_WINDOW_MS = 60 * 1000;
const DEFAULT_RAG_API_URL = 'http://192.168.1.15:8000';

export class ErpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErpConfigError';
  }
}

export interface ErpConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  redirectUri: string;
}

export interface ErpLinkRecord {
  userId: string;
  accessToken: string | null;
  refreshToken: string | null;
  accessExpiresAt: Date | null;
  employeeExternalId: string | null;
  employeeName: string | null;
  roleId: string | null;
  roleName: string | null;
  oauthState: string | null;
  oauthStateExpiresAt: Date | null;
}

export interface ErpRepository {
  findByUser(userId: string): Promise<ErpLinkRecord | null>;
  findByState(state: string): Promise<ErpLinkRecord | null>;
  upsertPending(userId: string, state: string, expiresAt: Date): Promise<void>;
  saveConnection(userId: string, connection: {
    accessToken: string;
    refreshToken: string;
    accessExpiresAt: Date;
    employeeExternalId: string;
    employeeName: string;
    roleId: string;
    roleName: string;
    connectedAt: Date;
  }): Promise<void>;
  clearState(userId: string): Promise<void>;
  deleteByUser(userId: string): Promise<void>;
  updateTokens(userId: string, tokens: { accessToken: string; refreshToken: string; accessExpiresAt: Date }): Promise<void>;
}

export interface ErpStatus {
  connected: boolean;
  employeeName: string | null;
  employeeExternalId: string | null;
  roleName: string | null;
}

export function erpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ErpConfig {
  const clientId = env.ERP_CLIENT_ID?.trim() ?? '';
  const clientSecret = env.ERP_CLIENT_SECRET?.trim() ?? '';
  const baseUrl = (env.ERP_BASE_URL?.trim() || 'http://192.168.1.15:8001').replace(/\/$/, '');
  const redirectUri = env.ERP_REDIRECT_URI?.trim() || 'http://localhost:3000/erp/callback';
  if (!clientId || !clientSecret) {
    throw new ErpConfigError('HIRECT ERP login is not configured.');
  }
  return { clientId, clientSecret, baseUrl, redirectUri };
}

export function newOauthState(): string {
  return randomBytes(32).toString('base64url');
}

export function buildAuthorizeUrl(config: ErpConfig, state: string): string {
  const url = new URL('/app/login/oauth2/authorize.nl', config.baseUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', 'rest_webservices');
  url.searchParams.set('state', state);
  return url.toString();
}

export function publicStatus(row: ErpLinkRecord | null): ErpStatus {
  if (!row?.accessToken) {
    return { connected: false, employeeName: null, employeeExternalId: null, roleName: null };
  }
  return {
    connected: true,
    employeeName: row.employeeName,
    employeeExternalId: row.employeeExternalId,
    roleName: row.roleName,
  };
}

export function parseWhoami(payload: unknown): {
  employeeExternalId: string;
  employeeName: string;
  roleId: string;
  roleName: string;
} {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const employee = body.employee && typeof body.employee === 'object' ? body.employee as Record<string, unknown> : {};
  const role = body.role && typeof body.role === 'object' ? body.role as Record<string, unknown> : {};
  const first = text(employee.firstName);
  const last = text(employee.lastName);
  const externalId = text(employee.externalId);
  const name = [first, last].filter(Boolean).join(' ') || externalId;
  return {
    employeeExternalId: externalId,
    employeeName: name,
    roleId: text(role.id),
    roleName: text(role.name),
  };
}

export async function beginConnect(userId: string, repo: ErpRepository, config: ErpConfig, now = new Date()): Promise<string> {
  const state = newOauthState();
  await repo.upsertPending(userId, state, new Date(now.getTime() + STATE_TTL_MS));
  return buildAuthorizeUrl(config, state);
}

export async function completeCallback(
  query: Record<string, unknown>,
  repo: ErpRepository,
  config: ErpConfig,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<{ status: number; html: string }> {
  const state = text(query.state);
  const error = text(query.error);
  const code = text(query.code);
  const pending = state ? await repo.findByState(state) : null;
  const stateOk = !!pending && !!pending.oauthStateExpiresAt && pending.oauthStateExpiresAt.getTime() > now.getTime();

  if (error === 'access_denied' && stateOk && pending) {
    await repo.clearState(pending.userId);
    return { status: 200, html: page('Sign-in cancelled', 'HIRECT sign-in was cancelled. Return to Jibbr and try again.') };
  }
  if (!stateOk || !pending || !code) {
    return { status: 400, html: page('Sign-in expired', 'This HIRECT sign-in link is no longer valid. Return to Jibbr and start again.') };
  }

  try {
    const tokens = await exchangeCode(config, code, fetchImpl);
    const whoami = parseWhoami(await fetchWhoami(config, tokens.accessToken, fetchImpl));
    await repo.saveConnection(pending.userId, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessExpiresAt: new Date(now.getTime() + tokens.expiresIn * 1000),
      ...whoami,
      connectedAt: now,
    });
    const who = whoami.employeeName ? ` for ${whoami.employeeName}` : '';
    return { status: 200, html: page('HIRECT connected', `HIRECT ERP is connected${who}. You can close this tab and return to Jibbr.`) };
  } catch (caught) {
    await repo.clearState(pending.userId);
    const detail = caught instanceof Error && caught.message ? caught.message : 'HIRECT did not accept this sign-in.';
    return { status: 502, html: page('Sign-in failed', detail) };
  }
}

export function ragApiBaseFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return (env.RAG_API_URL?.trim() || DEFAULT_RAG_API_URL).replace(/\/$/, '');
}

/** True when the access token is missing an expiry or is inside one minute of it. */
export function accessNeedsRefresh(expiresAt: Date | null, now = new Date()): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() - now.getTime() <= REFRESH_WINDOW_MS;
}

export interface AskPayload {
  question: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  conversation_id?: string;
  attachment_ids?: string[];
}

export function sanitizeAskBody(input: unknown): { ok: true; body: AskPayload } | { ok: false; message: string } {
  if (!input || typeof input !== 'object') return { ok: false, message: 'That question could not be sent.' };
  const row = input as Record<string, unknown>;
  if (typeof row.question !== 'string' || !row.question.trim()) {
    return { ok: false, message: 'That question could not be sent.' };
  }
  if (row.history !== undefined && !Array.isArray(row.history)) {
    return { ok: false, message: 'That question could not be sent.' };
  }
  const history = (Array.isArray(row.history) ? row.history : []).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const turn = item as Record<string, unknown>;
    const role = historyRole(turn.role);
    if (!role || typeof turn.content !== 'string') return [];
    return [{ role, content: turn.content }];
  });
  const body: AskPayload = { question: row.question, history };
  const conversationId = typeof row.conversation_id === 'string' ? row.conversation_id.trim() : '';
  const attachmentIds = Array.isArray(row.attachment_ids)
    ? row.attachment_ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map((id) => id.trim()).slice(-5)
    : [];
  if (conversationId && attachmentIds.length > 0) {
    body.conversation_id = conversationId;
    body.attachment_ids = attachmentIds;
  }
  return { ok: true, body };
}

export function erpStatusFromSse(raw: string): '' | 'connect' {
  let status: '' | 'connect' = '';
  for (const block of raw.replace(/\r\n/g, '\n').split('\n\n')) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trim());
    }
    if (event !== 'done' || data.length === 0) continue;
    try {
      const payload = JSON.parse(data.join('')) as { erp_status?: unknown };
      status = payload.erp_status === 'connect' ? 'connect' : '';
    } catch {
      status = '';
    }
  }
  return status;
}

export interface AskForwardResult {
  status: number;
  contentType: string;
  body: string;
  disconnected: boolean;
}

/**
 * Forwards one question to Local Rag. The ERP access token is attached here.
 * A `connect` result refreshes that token once and asks again. The Jibbr session is not forwarded.
 */
export async function forwardAsk(options: {
  userId: string;
  repo: ErpRepository;
  config: ErpConfig | null;
  ragBase: string;
  body: AskPayload;
  bypassCache: boolean;
  fetchImpl?: typeof fetch;
  now?: Date;
  signal?: AbortSignal;
}): Promise<AskForwardResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const prepared = await erpBearerForAsk(options.userId, options.repo, options.config, fetchImpl, now);
  const first = await callRag(options.ragBase, options.body, prepared.token, options.bypassCache, fetchImpl, options.signal);
  if (!isEventStream(first) || erpStatusFromSse(first.body) !== 'connect' || !prepared.token) {
    return { ...first, disconnected: prepared.disconnected };
  }
  if (!options.config) throw new ErpConfigError('HIRECT ERP login is not configured.');
  const refreshed = await refreshStoredAccess(options.userId, options.repo, options.config, fetchImpl, now);
  if (!refreshed) return { ...first, disconnected: true };
  const second = await callRag(options.ragBase, options.body, refreshed, true, fetchImpl, options.signal);
  return { ...second, disconnected: false };
}

async function erpBearerForAsk(
  userId: string,
  repo: ErpRepository,
  config: ErpConfig | null,
  fetchImpl: typeof fetch,
  now: Date,
): Promise<{ token: string | null; disconnected: boolean }> {
  const row = await repo.findByUser(userId);
  if (!row?.accessToken) return { token: null, disconnected: false };
  if (!accessNeedsRefresh(row.accessExpiresAt, now)) return { token: row.accessToken, disconnected: false };
  if (!config) throw new ErpConfigError('HIRECT ERP login is not configured.');
  const next = await refreshStoredAccess(userId, repo, config, fetchImpl, now);
  return next ? { token: next, disconnected: false } : { token: null, disconnected: true };
}

export async function refreshStoredAccess(
  userId: string,
  repo: ErpRepository,
  config: ErpConfig,
  fetchImpl: typeof fetch,
  now = new Date(),
): Promise<string | null> {
  const row = await repo.findByUser(userId);
  if (!row?.refreshToken) {
    if (row?.accessToken) await repo.deleteByUser(userId);
    return null;
  }
  try {
    const tokens = await refreshGrant(config, row.refreshToken, fetchImpl);
    await repo.updateTokens(userId, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken || row.refreshToken,
      accessExpiresAt: new Date(now.getTime() + tokens.expiresIn * 1000),
    });
    return tokens.accessToken;
  } catch {
    await repo.deleteByUser(userId);
    return null;
  }
}

async function callRag(
  ragBase: string,
  body: AskPayload,
  erpToken: string | null,
  bypassCache: boolean,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<Omit<AskForwardResult, 'disconnected'>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (erpToken) headers.Authorization = `Bearer ${erpToken}`;
  if (bypassCache) headers['X-Bypass-Cache'] = '1';
  const response = await fetchImpl(`${ragBase.replace(/\/$/, '')}/api/ask/stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  const raw = await response.text();
  const contentType = response.headers.get('content-type') || (response.ok ? 'text/event-stream' : 'application/json');
  return { status: response.status, contentType, body: raw };
}

function isEventStream(result: Omit<AskForwardResult, 'disconnected'>): boolean {
  return result.status === 200 && result.contentType.toLowerCase().includes('text/event-stream');
}

export async function disconnectErp(userId: string, repo: ErpRepository, config: ErpConfig, fetchImpl: typeof fetch = fetch): Promise<void> {
  const row = await repo.findByUser(userId);
  if (!row) return;
  if (row.refreshToken) await revokeRefreshToken(config, row.refreshToken, fetchImpl);
  await repo.deleteByUser(userId);
}

async function exchangeCode(config: ErpConfig, code: string, fetchImpl: typeof fetch): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
  });
  const payload = await tokenRequest(config, body, fetchImpl);
  const accessToken = text(payload.access_token);
  const refreshToken = text(payload.refresh_token);
  const expiresIn = typeof payload.expires_in === 'number' && payload.expires_in > 0 ? payload.expires_in : 3600;
  if (!accessToken || !refreshToken) throw new Error('HIRECT did not return a token.');
  return { accessToken, refreshToken, expiresIn };
}

async function fetchWhoami(config: ErpConfig, accessToken: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(`${config.baseUrl}/services/rest/system/v1/whoami`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorText(payload, 'HIRECT did not confirm this employee.'));
  return payload;
}

async function revokeRefreshToken(config: ErpConfig, refreshToken: string, fetchImpl: typeof fetch): Promise<void> {
  const response = await fetchImpl(`${config.baseUrl}/services/rest/auth/oauth2/v1/revoke`, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(config),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ token: refreshToken }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(errorText(payload, 'HIRECT could not disconnect this session.'));
  }
}

async function refreshGrant(
  config: ErpConfig,
  refreshToken: string,
  fetchImpl: typeof fetch,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const payload = await tokenRequest(config, new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }), fetchImpl);
  const accessToken = text(payload.access_token);
  const expiresIn = typeof payload.expires_in === 'number' && payload.expires_in > 0 ? payload.expires_in : 3600;
  if (!accessToken) throw new Error('HIRECT did not return a token.');
  return { accessToken, refreshToken: text(payload.refresh_token), expiresIn };
}

async function tokenRequest(config: ErpConfig, body: URLSearchParams, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  const response = await fetchImpl(`${config.baseUrl}/services/rest/auth/oauth2/v1/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(config),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== 'object') {
    throw new Error(errorText(payload, 'HIRECT did not accept this sign-in.'));
  }
  return payload as Record<string, unknown>;
}

function basicAuth(config: ErpConfig): string {
  return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`;
}

function errorText(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const body = payload as Record<string, unknown>;
  if (typeof body.error_description === 'string' && body.error_description.trim()) return body.error_description.trim();
  if (typeof body.message === 'string' && body.message.trim()) return body.message.trim();
  if (typeof body.detail === 'string' && body.detail.trim()) return body.detail.trim();
  return fallback;
}

function historyRole(value: unknown): 'user' | 'assistant' | null {
  return value === 'user' || value === 'assistant' ? value : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family: sans-serif; margin: 48px auto; max-width: 32rem; line-height: 1.5;">
  <h1 style="font-size: 1.25rem;">${escapeHtml(title)}</h1>
  <p>${escapeHtml(body)}</p>
</body>
</html>`;
}
