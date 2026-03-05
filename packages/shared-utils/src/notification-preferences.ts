/**
 * Notification preference types and shouldNotify logic.
 * Used by messaging-service and socket-service when creating notifications.
 */

export interface NotificationPrefsRaw {
  level?: string;
  muteAll?: boolean;
  tangentReplies?: boolean;
  starredMessagesEvenIfPaused?: boolean;
  newHuddles?: boolean;
  pushNotifications?: boolean;
  desktopNotifications?: boolean;
  scheduleEnabled?: boolean;
  scheduleMode?: string;
  scheduleDays?: number[];
  scheduleStart?: string;
  scheduleEnd?: string;
  timezone?: string | null;
}

export interface NotificationEventMeta {
  /** Channel message (not DM, not mention) */
  isChannelMessage?: boolean;
  /** Direct message */
  isDirectMessage?: boolean;
  /** User was @mentioned */
  isMention?: boolean;
  /** Tangent/thread reply */
  isTangentReply?: boolean;
  /** New huddle */
  isHuddle?: boolean;
  /** Message from starred user (future) */
  isStarred?: boolean;
  /** Reaction to user's message */
  isReaction?: boolean;
}

function getLocalTimeInTimezone(timezone: string | null): { day: number; minutes: number } {
  const now = new Date();
  if (!timezone) {
    return { day: now.getDay(), minutes: now.getHours() * 60 + now.getMinutes() };
  }
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      weekday: 'short',
    });
    const parts = fmt.formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
    const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { day: dayMap[weekday] ?? 0, minutes: hour * 60 + minute };
  } catch {
    return { day: now.getDay(), minutes: now.getHours() * 60 + now.getMinutes() };
  }
}

/**
 * Check if current time is within the user's notification schedule.
 */
function withinSchedule(
  enabled: boolean,
  mode: string,
  days: number[],
  startTime: string,
  endTime: string,
  timezone: string | null
): boolean {
  if (!enabled) return true;

  const { day, minutes: currentMinutes } = getLocalTimeInTimezone(timezone);
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  let allowedDays: number[];
  if (mode === 'every_day') {
    allowedDays = [0, 1, 2, 3, 4, 5, 6];
  } else if (mode === 'weekdays') {
    allowedDays = [1, 2, 3, 4, 5];
  } else {
    allowedDays = days ?? [1, 2, 3, 4, 5];
  }

  if (!allowedDays.includes(day)) return false;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

/**
 * Determine whether to send a notification based on user preferences and event metadata.
 */
export function shouldNotify(
  prefs: NotificationPrefsRaw | null | undefined,
  event: NotificationEventMeta
): boolean {
  if (!prefs) return true;

  if (prefs.muteAll) return false;

  if (
    prefs.scheduleEnabled &&
    !withinSchedule(
      true,
      prefs.scheduleMode ?? 'weekdays',
      prefs.scheduleDays ?? [1, 2, 3, 4, 5],
      prefs.scheduleStart ?? '09:00',
      prefs.scheduleEnd ?? '18:00',
      prefs.timezone ?? null
    )
  ) {
    return false;
  }

  const level = prefs.level ?? 'everything';
  if (level === 'nothing') return false;

  if (level === 'mentions') {
    if (event.isMention || event.isDirectMessage) {
      if (event.isMention && prefs.desktopNotifications === false) return false;
      return true;
    }
    return false;
  }

  if (event.isTangentReply && prefs.tangentReplies === false) return false;
  if (event.isHuddle && prefs.newHuddles === false) return false;

  return true;
}
