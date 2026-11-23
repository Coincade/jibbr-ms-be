import { describe, expect, it } from 'vitest';
import {
  formatHuddleEndedContent,
  huddleEndedDisplayText,
  parseHuddleEndedContent,
} from '../src/utils/huddle-message.js';

describe('huddle ended message helpers', () => {
  it('round-trips a huddle ended payload', () => {
    const payload = { durationMinutes: 12, peakCount: 4 };
    expect(parseHuddleEndedContent(formatHuddleEndedContent(payload))).toEqual(payload);
  });

  it('returns null for a normal chat message and for a broken marker', () => {
    expect(parseHuddleEndedContent('hello')).toBeNull();
    expect(parseHuddleEndedContent('[jibbr:huddle-ended]not-json')).toBeNull();
    expect(parseHuddleEndedContent('[jibbr:huddle-ended]{"durationMinutes":"x"}')).toBeNull();
  });

  it('renders a human readable summary', () => {
    expect(huddleEndedDisplayText({ durationMinutes: 1, peakCount: 1 })).toBe(
      'Huddle ended · 1 min · 1 person'
    );
    expect(huddleEndedDisplayText({ durationMinutes: 8, peakCount: 3 })).toBe(
      'Huddle ended · 8 min · 3 people'
    );
  });
});
