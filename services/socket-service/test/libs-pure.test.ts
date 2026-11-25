import { describe, expect, it } from 'vitest';
import { htmlToCleanText } from '../src/libs/htmlToCleanText.js';
import { sanitizeMessageHtml } from '../src/libs/sanitizeHtml.js';
import { parseMentions, parseMentionsFromJSON } from '../src/libs/tiptapMentionParser.js';

describe('socket message libs', () => {
  it('turns a mention span into a stored mention token', () => {
    const html =
      '<p>Hi <span class="mention" data-id="u2" data-label="Ada">@Ada</span></p>';
    expect(htmlToCleanText(html)).toBe('Hi @[Ada](u2)');
  });

  it('returns empty text for missing html', () => {
    expect(htmlToCleanText('')).toBe('');
  });

  it('keeps bold and italic as markers', () => {
    expect(htmlToCleanText('<p><strong>Hi</strong> <em>there</em></p>')).toBe('**Hi** *there*');
  });

  it('keeps ordered lists as numbered lines', () => {
    expect(htmlToCleanText('<ol><li><p>one</p></li><li><p>two</p></li></ol>')).toBe('1. one\n2. two');
  });

  it('keeps mention spans and drops scripts', () => {
    const clean = sanitizeMessageHtml(
      '<p>Hi <span class="mention" data-id="u2" data-type="user" data-label="Ada">@Ada</span><script>alert(1)</script></p>'
    );
    expect(clean).toContain('data-id="u2"');
    expect(clean).not.toContain('script');
  });

  it('reads user mentions from prose mirror json', () => {
    const mentions = parseMentionsFromJSON({
      type: 'doc',
      content: [
        {
          type: 'mention',
          attrs: { id: 'u2', type: 'user', label: 'Ada' },
        },
      ],
    });
    expect(mentions).toEqual([{ userId: 'u2', username: 'Ada' }]);
  });

  it('prefers json mentions over the html fallback', () => {
    expect(
      parseMentions('<p>plain</p>', {
        type: 'doc',
        content: [{ type: 'mention', attrs: { id: 'u9', type: 'user', username: 'Bea' } }],
      })
    ).toEqual([{ userId: 'u9', username: 'Bea' }]);
  });

  it('returns no mentions for empty json', () => {
    expect(parseMentionsFromJSON(null)).toEqual([]);
  });
});
