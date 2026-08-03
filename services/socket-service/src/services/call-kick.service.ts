export type CallRoomHostStatus = {
  active: boolean;
  hostUserId: string | null;
  isHost: boolean;
  participantCount: number;
};

const getCallServiceBaseUrl = (): string => {
  const baseRaw =
    process.env.CALL_SERVICE_INTERNAL_URL ||
    process.env.CALL_SERVICE_URL ||
    'http://localhost:3005';
  return baseRaw.replace(/\/$/, '');
};

/**
 * Ask call-service to remove a peer from the SFU room after membership revoke.
 */
export const kickPeerFromCallService = async (opts: {
  userId: string;
  channelId?: string;
  conversationId?: string;
}): Promise<boolean> => {
  const secret = process.env.INTERNAL_SERVICE_SECRET?.trim();
  const baseUrl = getCallServiceBaseUrl();

  if (!secret) {
    console.warn(
      '[call-kick] INTERNAL_SERVICE_SECRET unset — cannot kick revoked member from SFU'
    );
    return false;
  }

  try {
    const res = await fetch(`${baseUrl}/internal/call/kick-peer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret,
      },
      body: JSON.stringify({
        userId: opts.userId,
        ...(opts.channelId ? { channelId: opts.channelId } : {}),
        ...(opts.conversationId ? { conversationId: opts.conversationId } : {}),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[call-kick] kick-peer failed (${res.status}): ${text}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn('[call-kick] kick-peer request error:', error);
    return false;
  }
};

/**
 * Resolve whether a user is the current SFU host for a room.
 * Returns null when call-service is unreachable / misconfigured.
 */
export const fetchCallRoomHostStatus = async (opts: {
  userId: string;
  channelId?: string;
  conversationId?: string;
}): Promise<CallRoomHostStatus | null> => {
  const secret = process.env.INTERNAL_SERVICE_SECRET?.trim();
  const baseUrl = getCallServiceBaseUrl();

  if (!secret) {
    console.warn(
      '[call-host] INTERNAL_SERVICE_SECRET unset — cannot verify huddle host'
    );
    return null;
  }

  try {
    const res = await fetch(`${baseUrl}/internal/call/host-check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret,
      },
      body: JSON.stringify({
        userId: opts.userId,
        ...(opts.channelId ? { channelId: opts.channelId } : {}),
        ...(opts.conversationId ? { conversationId: opts.conversationId } : {}),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[call-host] host-check failed (${res.status}): ${text}`);
      return null;
    }
    const data = (await res.json()) as Partial<CallRoomHostStatus>;
    return {
      active: !!data.active,
      hostUserId: typeof data.hostUserId === 'string' ? data.hostUserId : null,
      isHost: !!data.isHost,
      participantCount:
        typeof data.participantCount === 'number' ? data.participantCount : 0,
    };
  } catch (error) {
    console.warn('[call-host] host-check request error:', error);
    return null;
  }
};
