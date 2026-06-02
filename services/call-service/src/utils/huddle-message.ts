/** Machine-readable huddle-ended marker in Message.content (rendered specially in clients). */
export const HUDDLE_ENDED_PREFIX = '[jibbr:huddle-ended]';

export type HuddleEndedPayload = {
  durationMinutes: number;
  peakCount: number;
};

export const formatHuddleEndedContent = (payload: HuddleEndedPayload): string =>
  `${HUDDLE_ENDED_PREFIX}${JSON.stringify(payload)}`;

export const parseHuddleEndedContent = (content: string): HuddleEndedPayload | null => {
  if (!content.startsWith(HUDDLE_ENDED_PREFIX)) return null;
  try {
    const parsed = JSON.parse(content.slice(HUDDLE_ENDED_PREFIX.length)) as HuddleEndedPayload;
    if (
      typeof parsed.durationMinutes === 'number' &&
      typeof parsed.peakCount === 'number'
    ) {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
};

export const huddleEndedDisplayText = (payload: HuddleEndedPayload): string => {
  const mins = payload.durationMinutes;
  const people = payload.peakCount;
  const minLabel = mins === 1 ? '1 min' : `${mins} min`;
  const peopleLabel = people === 1 ? '1 person' : `${people} people`;
  return `Huddle ended · ${minLabel} · ${peopleLabel}`;
};
