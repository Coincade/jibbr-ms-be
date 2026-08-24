import {
  buildUnsupportedWsPayload,
  evaluateDesktopVersion,
  getDesktopVersionPolicy,
  mergeDesktopClientMeta,
  parseDesktopClientFromRecord,
  parseDesktopClientFromRequestUrl,
  recordDesktopClientSeen,
  shouldRejectDesktopClient,
  WS_CLOSE_CODE_UNSUPPORTED,
  WS_CLIENT_VERSION_UNSUPPORTED,
  type DesktopClientMeta,
} from '@jibbr/shared-utils';
import type { WebSocket } from 'ws';

export function extractDesktopMetaFromUpgradeUrl(requestUrl?: string | null): DesktopClientMeta | null {
  return parseDesktopClientFromRequestUrl(requestUrl);
}

export function extractDesktopMetaFromFrame(frame: { type?: string; data?: Record<string, unknown> } | null): DesktopClientMeta | null {
  if (!frame?.data) return null;
  if (frame.type === 'auth' || frame.type === 'client_info') {
    return parseDesktopClientFromRecord(frame.data);
  }
  return parseDesktopClientFromRecord(frame.data);
}

export function applyDesktopMeta(
  existing: DesktopClientMeta | null | undefined,
  incoming: DesktopClientMeta | null | undefined
): DesktopClientMeta | null {
  return mergeDesktopClientMeta(existing, incoming);
}

export function rejectUnsupportedDesktopWs(
  ws: WebSocket,
  meta: DesktopClientMeta | null | undefined,
  userId?: string
): boolean {
  if (!meta) return false;
  const policy = getDesktopVersionPolicy();
  const evaluation = evaluateDesktopVersion(meta.version, policy);
  if (!shouldRejectDesktopClient(evaluation, policy)) return false;

  const payload = buildUnsupportedWsPayload(evaluation);
  console.warn(
    JSON.stringify({
      service: 'socket-service',
      level: 'warn',
      message: WS_CLIENT_VERSION_UNSUPPORTED,
      userId: userId || undefined,
      client: meta.client,
      version: meta.version,
      platform: meta.platform,
      arch: meta.arch,
    })
  );

  try {
    if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
      ws.send(JSON.stringify(payload));
    }
  } catch {
    // ignore
  }
  try {
    ws.close(WS_CLOSE_CODE_UNSUPPORTED, WS_CLIENT_VERSION_UNSUPPORTED);
  } catch {
    // ignore
  }
  return true;
}

export async function rememberDesktopClient(userId: string, meta: DesktopClientMeta | null | undefined): Promise<void> {
  if (!userId || !meta) return;
  await recordDesktopClientSeen(userId, meta);
  console.info(
    JSON.stringify({
      service: 'socket-service',
      level: 'info',
      message: 'desktop client connected',
      userId,
      client: meta.client,
      version: meta.version,
      platform: meta.platform,
      arch: meta.arch,
      timestamp: new Date().toISOString(),
    })
  );
}
