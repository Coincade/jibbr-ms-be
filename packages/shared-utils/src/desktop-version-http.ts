import type { DesktopClientMeta, DesktopVersionEvaluation } from './desktop-version';
import {
  buildUnsupportedHttpBody,
  evaluateDesktopVersion,
  getDesktopVersionPolicy,
  HTTP_STATUS_CLIENT_UNSUPPORTED,
  parseDesktopClientHeaders,
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

    const policy = getDesktopVersionPolicy();
    const evaluation = evaluateDesktopVersion(meta.version, policy);
    if (res.locals) {
      res.locals.jibbrDesktop = { meta, evaluation };
    }

    if (evaluation.malformed || evaluation.missingVersion) {
      console.warn(
        JSON.stringify({
          service: 'desktop-version',
          level: 'warn',
          message: 'Desktop client version metadata missing or invalid',
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
  const policy = getDesktopVersionPolicy();
  if (!meta) {
    res.status(200).json(toVersionStatusResponse(evaluateDesktopVersion(null, policy), false));
    return;
  }
  const evaluation = evaluateDesktopVersion(meta.version, policy);
  res.status(200).json(toVersionStatusResponse(evaluation, true));
}

export type LocalsDesktopVersion = {
  meta: DesktopClientMeta;
  evaluation: DesktopVersionEvaluation;
};
