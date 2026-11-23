import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldNotify, type NotificationPrefsRaw } from './notification-preferences';

const prefs = (overrides: NotificationPrefsRaw = {}): NotificationPrefsRaw => ({
  level: 'everything',
  muteAll: false,
  tangentReplies: true,
  newHuddles: true,
  ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('shouldNotify', () => {
  it('allows the event when preferences are missing', () => {
    expect(shouldNotify(null, { isChannelMessage: true })).toBe(true);
    expect(shouldNotify(undefined, { isChannelMessage: true })).toBe(true);
  });

  it('blocks every event when muteAll is set', () => {
    expect(shouldNotify(prefs({ muteAll: true }), { isMention: true })).toBe(false);
  });

  it('blocks every event when the level is nothing', () => {
    expect(shouldNotify(prefs({ level: 'nothing' }), { isMention: true })).toBe(false);
  });

  it('allows mentions and direct messages when the level is mentions', () => {
    const mentions = prefs({ level: 'mentions' });
    expect(shouldNotify(mentions, { isMention: true })).toBe(true);
    expect(shouldNotify(mentions, { isDirectMessage: true })).toBe(true);
    expect(shouldNotify(mentions, { isChannelMessage: true })).toBe(false);
  });

  it('blocks a mention when desktop notifications are turned off', () => {
    expect(
      shouldNotify(prefs({ level: 'mentions', desktopNotifications: false }), { isMention: true })
    ).toBe(false);
  });

  it('blocks tangent replies and huddles when those toggles are off', () => {
    expect(shouldNotify(prefs({ tangentReplies: false }), { isTangentReply: true })).toBe(false);
    expect(shouldNotify(prefs({ newHuddles: false }), { isHuddle: true })).toBe(false);
    expect(shouldNotify(prefs(), { isChannelMessage: true })).toBe(true);
  });

  it('blocks a weekday notification outside the schedule window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T20:00:00Z'));
    expect(
      shouldNotify(
        prefs({
          scheduleEnabled: true,
          scheduleMode: 'weekdays',
          scheduleStart: '09:00',
          scheduleEnd: '18:00',
          timezone: 'UTC',
        }),
        { isChannelMessage: true }
      )
    ).toBe(false);
  });

  it('allows a weekday notification inside the schedule window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T10:00:00Z'));
    expect(
      shouldNotify(
        prefs({
          scheduleEnabled: true,
          scheduleMode: 'weekdays',
          scheduleStart: '09:00',
          scheduleEnd: '18:00',
          timezone: 'UTC',
        }),
        { isChannelMessage: true }
      )
    ).toBe(true);
  });

  it('blocks a weekend notification on a weekday schedule', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-04T10:00:00Z'));
    expect(
      shouldNotify(
        prefs({
          scheduleEnabled: true,
          scheduleMode: 'weekdays',
          scheduleStart: '09:00',
          scheduleEnd: '18:00',
          timezone: 'UTC',
        }),
        { isChannelMessage: true }
      )
    ).toBe(false);
  });

  it('treats a window that crosses midnight as inside late at night and outside at noon', () => {
    const overnight = prefs({
      scheduleEnabled: true,
      scheduleMode: 'every_day',
      scheduleStart: '22:00',
      scheduleEnd: '06:00',
      timezone: 'UTC',
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T23:00:00Z'));
    expect(shouldNotify(overnight, { isChannelMessage: true })).toBe(true);

    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'));
    expect(shouldNotify(overnight, { isChannelMessage: true })).toBe(false);
  });
});
