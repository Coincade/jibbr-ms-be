import semver from 'semver';

export const DESKTOP_CLIENT_ID = 'desktop';
export const MOBILE_CLIENT_ID = 'mobile';
export const WEB_CLIENT_ID = 'web';

export const KNOWN_CLIENT_IDS = [DESKTOP_CLIENT_ID, MOBILE_CLIENT_ID, WEB_CLIENT_ID] as const;
export type JibbrClientId = (typeof KNOWN_CLIENT_IDS)[number];

export const CLIENT_VERSION_UNSUPPORTED = 'CLIENT_VERSION_UNSUPPORTED';
export const WS_CLIENT_VERSION_UNSUPPORTED = 'client_version_unsupported';
export const WS_CLOSE_CODE_UNSUPPORTED = 4403;
export const HTTP_STATUS_CLIENT_UNSUPPORTED = 426;

export const HEADER_CLIENT = 'x-jibbr-client';
export const HEADER_VERSION = 'x-jibbr-version';
export const HEADER_PLATFORM = 'x-jibbr-platform';
export const HEADER_ARCH = 'x-jibbr-arch';

const DEFAULT_LATEST = '0.1.1';
const DEFAULT_MIN = '0.1.0';
const MAX_META_LEN = 64;

/** Conservative defaults: never lock out current production mobile/web until env is set. */
const POLICY_DEFAULTS: Record<JibbrClientId, { latest: string; min: string }> = {
  desktop: { latest: DEFAULT_LATEST, min: DEFAULT_MIN },
  mobile: { latest: '1.0.0', min: '0.0.0' },
  web: { latest: '0.0.0', min: '0.0.0' },
};

const ENV_PREFIX: Record<JibbrClientId, string> = {
  desktop: 'JIBBR_DESKTOP',
  mobile: 'JIBBR_MOBILE',
  web: 'JIBBR_WEB',
};

export type DesktopVersionPolicy = {
  latestVersion: string;
  minimumSupportedVersion: string;
  updateUrl: string;
  forceUpdate: boolean;
  /** When true, identified desktop clients with missing/invalid versions are rejected. Default false (phase 1). */
  requireVersion: boolean;
};

export type DesktopVersionEvaluation = {
  client: JibbrClientId | 'unknown';
  currentVersion: string | null;
  latestVersion: string;
  minimumSupportedVersion: string;
  supported: boolean;
  updateAvailable: boolean;
  updateRequired: boolean;
  clientSupported: boolean;
  malformed: boolean;
  missingVersion: boolean;
};

export type DesktopClientMeta = {
  client: string;
  version: string | null;
  platform: string | null;
  arch: string | null;
};

export type DesktopUnsupportedErrorBody = {
  error: {
    code: typeof CLIENT_VERSION_UNSUPPORTED;
    message: string;
    currentVersion: string | null;
    minimumSupportedVersion: string;
    latestVersion: string;
    updateRequired: true;
    updateUrl?: string;
  };
};

function envString(name: string): string {
  const raw = process.env[name];
  return typeof raw === 'string' ? raw.trim() : '';
}

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = envString(name).toLowerCase();
  if (!raw) return defaultValue;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return defaultValue;
}

export function sanitizeClientMeta(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_META_LEN) return null;
  if (!/^[A-Za-z0-9._+-]+$/.test(trimmed)) return null;
  return trimmed;
}

/** Returns a canonical semver string, or null if the input is not a usable version. */
export function parseDesktopSemver(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_META_LEN) return null;
  if (!/\d+\.\d+/.test(trimmed) && !semver.valid(trimmed)) return null;
  const cleaned = semver.valid(semver.coerce(trimmed));
  return cleaned;
}

export function getClientVersionPolicy(client: JibbrClientId): DesktopVersionPolicy {
  const prefix = ENV_PREFIX[client];
  const defaults = POLICY_DEFAULTS[client];
  const latestParsed = parseDesktopSemver(envString(`${prefix}_LATEST_VERSION`)) || defaults.latest;
  const minParsed = parseDesktopSemver(envString(`${prefix}_MIN_VERSION`)) || defaults.min;
  return {
    latestVersion: latestParsed,
    minimumSupportedVersion: minParsed,
    updateUrl: envString(`${prefix}_UPDATE_URL`),
    forceUpdate: envFlag(`${prefix}_FORCE_UPDATE`, false),
    requireVersion: envFlag(`${prefix}_REQUIRE_VERSION`, false),
  };
}

export function getDesktopVersionPolicy(): DesktopVersionPolicy {
  return getClientVersionPolicy(DESKTOP_CLIENT_ID);
}

/**
 * Server-authoritative desktop compatibility evaluation.
 * `supported` means the client may continue using the product.
 */
export function evaluateClientVersion(
  client: JibbrClientId,
  currentVersion: string | null | undefined,
  policy: DesktopVersionPolicy = getClientVersionPolicy(client)
): DesktopVersionEvaluation {
  const parsed = parseDesktopSemver(currentVersion ?? null);
  const missingVersion = currentVersion == null || String(currentVersion).trim() === '';
  const malformed = !missingVersion && !parsed;

  if (!parsed) {
    const allow = !policy.requireVersion;
    return {
      client,
      currentVersion: missingVersion ? null : String(currentVersion).slice(0, MAX_META_LEN),
      latestVersion: policy.latestVersion,
      minimumSupportedVersion: policy.minimumSupportedVersion,
      supported: allow,
      updateAvailable: false,
      updateRequired: !allow,
      clientSupported: allow,
      malformed,
      missingVersion,
    };
  }

  const aboveMin = semver.gte(parsed, policy.minimumSupportedVersion);
  const updateAvailable = semver.lt(parsed, policy.latestVersion);
  const updateRequired = !aboveMin || (policy.forceUpdate && updateAvailable);
  const supported = aboveMin && !updateRequired;

  return {
    client,
    currentVersion: parsed,
    latestVersion: policy.latestVersion,
    minimumSupportedVersion: policy.minimumSupportedVersion,
    supported,
    updateAvailable,
    updateRequired,
    clientSupported: supported,
    malformed: false,
    missingVersion: false,
  };
}

export function evaluateDesktopVersion(
  currentVersion: string | null | undefined,
  policy: DesktopVersionPolicy = getDesktopVersionPolicy()
): DesktopVersionEvaluation {
  return evaluateClientVersion(DESKTOP_CLIENT_ID, currentVersion, policy);
}

export function parseJibbrClientId(value: unknown): JibbrClientId | null {
  if (typeof value !== 'string') return null;
  const id = value.trim().toLowerCase();
  if (id === DESKTOP_CLIENT_ID || id === MOBILE_CLIENT_ID || id === WEB_CLIENT_ID) return id;
  return null;
}

export function isDesktopClientName(value: unknown): boolean {
  return parseJibbrClientId(value) === DESKTOP_CLIENT_ID;
}

export function headerValue(headers: Record<string, unknown> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const [key, raw] of Object.entries(headers)) {
    if (key.toLowerCase() !== lower) continue;
    if (Array.isArray(raw)) return typeof raw[0] === 'string' ? raw[0] : undefined;
    return typeof raw === 'string' ? raw : undefined;
  }
  return undefined;
}

export function parseDesktopClientHeaders(
  headers: Record<string, unknown> | undefined
): DesktopClientMeta | null {
  const client = parseJibbrClientId(headerValue(headers, HEADER_CLIENT));
  if (!client) return null;
  return {
    client,
    version: sanitizeClientMeta(headerValue(headers, HEADER_VERSION)),
    platform: sanitizeClientMeta(headerValue(headers, HEADER_PLATFORM)),
    arch: sanitizeClientMeta(headerValue(headers, HEADER_ARCH)),
  };
}

export function parseDesktopClientFromRecord(record: Record<string, unknown> | null | undefined): DesktopClientMeta | null {
  if (!record) return null;
  const client = parseJibbrClientId(record.client ?? record.jibbrClient);
  if (!client) {
    return null;
  }
  return {
    client,
    version: sanitizeClientMeta(record.version ?? record.jibbrVersion),
    platform: sanitizeClientMeta(record.platform ?? record.jibbrPlatform),
    arch: sanitizeClientMeta(record.arch ?? record.jibbrArch),
  };
}

export function parseDesktopClientFromRequestUrl(requestUrl?: string | null): DesktopClientMeta | null {
  if (!requestUrl) return null;
  try {
    const url = new URL(requestUrl, 'http://localhost');
    return parseDesktopClientFromRecord({
      client: url.searchParams.get('client') ?? undefined,
      version: url.searchParams.get('version') ?? undefined,
      platform: url.searchParams.get('platform') ?? undefined,
      arch: url.searchParams.get('arch') ?? undefined,
    });
  } catch {
    return null;
  }
}

export function mergeDesktopClientMeta(
  ...parts: Array<DesktopClientMeta | null | undefined>
): DesktopClientMeta | null {
  const present = parts.filter((p): p is DesktopClientMeta => !!p);
  if (present.length === 0) return null;
  return present.reduce<DesktopClientMeta>(
    (acc, part) => ({
      client: part.client || acc.client,
      version: part.version ?? acc.version,
      platform: part.platform ?? acc.platform,
      arch: part.arch ?? acc.arch,
    }),
    { client: present[0].client, version: null, platform: null, arch: null }
  );
}

export function shouldRejectDesktopClient(evaluation: DesktopVersionEvaluation, policy: DesktopVersionPolicy): boolean {
  if (evaluation.missingVersion || evaluation.malformed) {
    return policy.requireVersion;
  }
  return evaluation.updateRequired;
}

function policyForClient(evaluation: DesktopVersionEvaluation): DesktopVersionPolicy {
  const client = parseJibbrClientId(evaluation.client);
  return client ? getClientVersionPolicy(client) : getDesktopVersionPolicy();
}

export function buildUnsupportedHttpBody(
  evaluation: DesktopVersionEvaluation,
  policy: DesktopVersionPolicy = policyForClient(evaluation)
): DesktopUnsupportedErrorBody {
  const body: DesktopUnsupportedErrorBody = {
    error: {
      code: CLIENT_VERSION_UNSUPPORTED,
      message: 'This version of Jibbr is no longer supported.',
      currentVersion: evaluation.currentVersion,
      minimumSupportedVersion: evaluation.minimumSupportedVersion,
      latestVersion: evaluation.latestVersion,
      updateRequired: true,
    },
  };
  if (policy.updateUrl) {
    body.error.updateUrl = policy.updateUrl;
  }
  return body;
}

export function buildUnsupportedWsPayload(evaluation: DesktopVersionEvaluation): Record<string, unknown> {
  return {
    type: WS_CLIENT_VERSION_UNSUPPORTED,
    currentVersion: evaluation.currentVersion,
    minimumSupportedVersion: evaluation.minimumSupportedVersion,
    latestVersion: evaluation.latestVersion,
  };
}

export function toVersionStatusResponse(
  evaluation: DesktopVersionEvaluation,
  isDesktop: boolean
): Record<string, unknown> {
  if (!isDesktop) {
    const policy = getDesktopVersionPolicy();
    return {
      client: 'unknown',
      currentVersion: null,
      latestVersion: policy.latestVersion,
      minimumSupportedVersion: policy.minimumSupportedVersion,
      supported: true,
      updateAvailable: false,
      updateRequired: false,
    };
  }
  return {
    client: evaluation.client,
    currentVersion: evaluation.currentVersion,
    latestVersion: evaluation.latestVersion,
    minimumSupportedVersion: evaluation.minimumSupportedVersion,
    supported: evaluation.supported,
    updateAvailable: evaluation.updateAvailable,
    updateRequired: evaluation.updateRequired,
  };
}
