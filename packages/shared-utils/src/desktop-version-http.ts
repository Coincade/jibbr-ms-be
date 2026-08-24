import type { DesktopClientMeta, DesktopVersionEvaluation } from './desktop-version';
import {
  buildUnsupportedHttpBody,
  evaluateClientVersion,
  getClientVersionPolicy,
  HTTP_STATUS_CLIENT_UNSUPPORTED,
  parseDesktopClientHeaders,
  parseJibbrClientId,
  shouldRejectDesktopClient,
  toVersionStatusResponse,
} from './desktop-version';
type NextFn = (err?: unknown) => void;

type HttpLikeRequest = {
  headers: Record<string, unknown>;
  path?: string;
  originalUrl?: string;
  url?: string;
};

type HttpLikeResponse = {
  locals?: Record<string, unknown>;
  status: (code: number) => { json: (body: unknown) => unknown };
  json: (body: unknown) => unknown;
};

const DEFAULT_EXEMPT_PREFIXES = [
  '/health',
  '/internal',
  '/api/internal',
  '/api/client/version-status',
  '/client/version-status',
];

function requestPath(req: HttpLikeRequest): string {
  const raw = req.path || req.originalUrl || req.url || '';
  return String(raw).split('?')[0];
}

function isExemptPath(path: string, extra: string[]): boolean {
  const prefixes = [...DEFAULT_EXEMPT_PREFIXES, ...extra];
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function createDesktopVersionMiddleware(options?: { extraExemptPrefixes?: string[] }) {
  const extra = options?.extraExemptPrefixes ?? [];
  return (req: HttpLikeRequest, res: HttpLikeResponse, next: NextFn): void => {
    const path = requestPath(req);
    if (isExemptPath(path, extra)) {
      next();
      return;
    }

    const meta = parseDesktopClientHeaders(req.headers as Record<string, unknown>);
    if (!meta) {
      if (res.locals) {
        res.locals.jibbrDesktop = null;
      }
      next();
      return;
    }

    const clientId = parseJibbrClientId(meta.client);
    if (!clientId) {
      next();
      return;
    }
    const policy = getClientVersionPolicy(clientId);
    const evaluation = evaluateClientVersion(clientId, meta.version, policy);
    if (res.locals) {
      res.locals.jibbrDesktop = { meta, evaluation };
    }

    if (evaluation.malformed || evaluation.missingVersion) {
      console.warn(
        JSON.stringify({
          service: 'desktop-version',
          level: 'warn',
          message: 'Client version metadata missing or invalid',
          client: meta.client,
          version: meta.version,
          platform: meta.platform,
          arch: meta.arch,
          malformed: evaluation.malformed,
          missingVersion: evaluation.missingVersion,
        })
      );
    }

    if (shouldRejectDesktopClient(evaluation, policy)) {
      res.status(HTTP_STATUS_CLIENT_UNSUPPORTED).json(buildUnsupportedHttpBody(evaluation, policy));
      return;
    }

    next();
  };
}

export function handleDesktopVersionStatus(req: HttpLikeRequest, res: HttpLikeResponse): void {
  const meta = parseDesktopClientHeaders(req.headers as Record<string, unknown>);
  if (!meta) {
    res.status(200).json(toVersionStatusResponse(evaluateClientVersion('desktop', null), false));
    return;
  }
  const clientId = parseJibbrClientId(meta.client);
  if (!clientId) {
    res.status(200).json(toVersionStatusResponse(evaluateClientVersion('desktop', null), false));
    return;
  }
  const policy = getClientVersionPolicy(clientId);
  const evaluation = evaluateClientVersion(clientId, meta.version, policy);
  res.status(200).json(toVersionStatusResponse(evaluation, true));
}

export type LocalsDesktopVersion = {
  meta: DesktopClientMeta;
  evaluation: DesktopVersionEvaluation;
};
