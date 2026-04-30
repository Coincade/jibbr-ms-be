import { describe, expect, it } from 'vitest';

import { getEmailDomain } from '../src/helpers/domainUtils.js';
import generateCode from '../src/helpers/generateCode.js';
import { htmlToCleanText } from '../src/libs/htmlToCleanText.js';
import { sanitizeMessageHtml } from '../src/libs/sanitizeHtml.js';
import {
  parseMentions,
  parseMentionsFromHTML,
  parseMentionsFromJSON,
} from '../src/libs/tiptapMentionParser.js';

describe('small helpers and libs', () => {
  it('getEmailDomain parses valid email and rejects invalid values', () => {
    expect(getEmailDomain('A@Example.com')).toBe('example.com');
    expect(getEmailDomain('no-at-sign')).toBeNull();
    expect(getEmailDomain('')).toBeNull();
  });

  it('generateCode creates 6 digit numeric code without leading zero', () => {
    const code = generateCode();
    expect(code).toMatch(/^[1-9][0-9]{5}$/);
  });

  it('htmlToCleanText converts mention spans, blocks and entities', () => {
    const input =
      '<p><span class="mention" data-id="u1" data-label="alice">@alice</span>&nbsp;hello&amp;bye</p><p>next</p>';
    const out = htmlToCleanText(input);
    expect(out).toContain('@[alice](u1)');
    expect(out).toContain('hello&bye');
    expect(out).toContain('next');
  });

  it('sanitizeMessageHtml keeps mention spans and strips unsafe tags', () => {
    const out = sanitizeMessageHtml(
      '<script>alert(1)</script><span class="mention" data-id="u1" data-label="alice">@alice</span><span>plain</span>'
    );
    expect(out).toContain('class="mention"');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('<span>plain</span>');
  });

  it('parseMentionsFromJSON returns unique user mentions', () => {
    const json = {
      type: 'doc',
      content: [
        { type: 'mention', attrs: { id: 'u1', username: 'alice', type: 'user' } },
        { type: 'mention', attrs: { id: 'u1', label: 'alice', type: 'user' } },
        { type: 'mention', attrs: { id: 'ch1', username: 'general', type: 'channel' } },
      ],
    };
    expect(parseMentionsFromJSON(json)).toEqual([{ userId: 'u1', username: 'alice' }]);
  });

  it('parseMentionsFromHTML and parseMentions fallback behavior', () => {
    const html = '<span class="mention" data-id="u2" data-label="bob">@bob</span>';
    expect(parseMentionsFromHTML(html)).toEqual([{ userId: 'u2', username: 'bob' }]);
    expect(parseMentions('hello', { type: 'doc', content: [] })).toEqual([]);
    expect(parseMentions(html)).toEqual([{ userId: 'u2', username: 'bob' }]);
  });
});
