/**
 * Convert TipTap/HTML message content to clean text for DB storage.
 * - Mention spans → @[label](id)
 * - Bold, italic, underline, strike → ** * ++ ~~ markers that both clients render
 * - Unordered lists → "- item", ordered lists → "1. item" (nested lists keep a two-space indent)
 * - <br> and block boundaries → newlines
 * - Strip remaining tags, decode entities, normalize whitespace
 */
const FORMAT_TAGS: Array<[string, string, string]> = [
  ['strong', '**', '**'],
  ['b', '**', '**'],
  ['em', '*', '*'],
  ['i', '*', '*'],
  ['u', '++', '++'],
  ['s', '~~', '~~'],
  ['strike', '~~', '~~'],
  ['del', '~~', '~~'],
];

/** Turn formatting tags into markers before the generic tag strip. Nested tags are unwrapped inside-out. */
function preserveFormattingTags(html: string): string {
  let out = html;
  let changed = true;
  while (changed) {
    changed = false;
    for (const [tag, open, close] of FORMAT_TAGS) {
      const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'gi');
      const next = out.replace(re, (match, inner: string) => {
        if (inner.includes('<')) return match;
        return `${open}${inner}${close}`;
      });
      if (next !== out) {
        out = next;
        changed = true;
      }
    }
  }
  return out;
}

/** Turn the innermost list into marker lines, then the list that wrapped it. */
function preserveLists(html: string): string {
  let out = html;
  const listRe = /<(ul|ol)\b[^>]*>((?:(?!<\/?(?:ul|ol)\b)[\s\S])*?)<\/\1>/gi;
  for (let guard = 0; guard < 20; guard++) {
    let replaced = false;
    listRe.lastIndex = 0;
    out = out.replace(listRe, (match, kind: string, inner: string) => {
      replaced = true;
      const ordered = kind.toLowerCase() === 'ol';
      const startMatch = match.match(/\bstart=["']?(\d+)/i);
      let number = startMatch ? Number(startMatch[1]) : 1;
      const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)];
      const lines = items.map((item) => {
        const body = item[1]
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>\s*<p\b[^>]*>/gi, '\n')
          .replace(/<\/?p\b[^>]*>/gi, '')
          .replace(/<\/?div\b[^>]*>/gi, '')
          .trim();
        if (!body) return '';
        const prefix = ordered ? `${number}. ` : '- ';
        if (ordered) number += 1;
        return body
          .split('\n')
          .map((line, lineIndex) => (lineIndex === 0 ? `${prefix}${line.trim()}` : `  ${line.trim()}`))
          .join('\n');
      });
      const block = lines.filter(Boolean).join('\n');
      return block ? `\n${block}\n` : '';
    });
    if (!replaced) break;
  }
  return out;
}

function markerIsOpen(text: string): boolean {
  const bold = (text.match(/\*\*/g) || []).length % 2 === 1;
  const underline = (text.match(/\+\+/g) || []).length % 2 === 1;
  const strike = (text.match(/~~/g) || []).length % 2 === 1;
  const italic = (text.replace(/\*\*/g, '').match(/\*/g) || []).length % 2 === 1;
  return bold || underline || strike || italic;
}

/** Keep a two-space indent on list rows; trim everything else. */
function tidyLine(line: string): string {
  const trimmedEnd = line.replace(/[ \t]+$/g, '');
  const match = trimmedEnd.match(/^([ \t]*)([\s\S]*)$/);
  if (!match) return '';
  const body = match[2].trim();
  if (!body) return '';
  if (/^(?:[-*]|•|\d+\.)\s+/.test(body)) {
    const spaces = match[1].replace(/\t/g, '  ').length;
    const level = Math.floor(spaces / 2);
    return `${'  '.repeat(level)}${body}`;
  }
  return body;
}

/** Trim lines, but keep a wrapped phrase together when a marker crosses a break. */
function normalizeLines(text: string): string {
  const lines = text.split('\n');
  const merged: string[] = [];
  let buffer = '';
  const finish = () => {
    if (!buffer) return;
    merged.push(buffer);
    buffer = '';
  };
  for (const raw of lines) {
    const line = tidyLine(raw);
    if (!line) {
      if (!markerIsOpen(buffer)) finish();
      continue;
    }
    if (buffer && markerIsOpen(buffer)) buffer = `${buffer} ${line.trim()}`;
    else {
      finish();
      buffer = line;
    }
    if (!markerIsOpen(buffer)) finish();
  }
  finish();
  return merged.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function htmlToCleanText(html: string): string {
  if (!html || typeof html !== 'string') return '';

  let out = html;

  // Replace mention spans with @[label](id)
  out = out.replace(
    /<span[^>]*class=["']mention["'][^>]*data-id=["']([^"']+)["'][^>]*data-label=["']([^"']+)["'][^>]*>[^<]*<\/span>/gi,
    (_, id, label) => `@[${label}](${id})`
  );
  out = out.replace(
    /<span[^>]*data-label=["']([^"']+)["'][^>]*data-id=["']([^"']+)["'][^>]*class=["']mention["'][^>]*>[^<]*<\/span>/gi,
    (_, label, id) => `@[${label}](${id})`
  );
  out = out.replace(
    /<span[^>]*data-id=["']([^"']+)["'][^>]*data-username=["']([^"']+)["'][^>]*>[^<]*<\/span>/gi,
    (_, id, label) => `@[${label}](${id})`
  );

  // Line breaks first so formatting tags can be wrapped even when they contain a <br>
  out = out.replace(/<br\s*\/?>/gi, '\n');
  out = preserveFormattingTags(out);
  out = preserveLists(out);

  // Block boundaries → newlines
  out = out.replace(/<\/p>\s*<p[^>]*>/gi, '\n\n');
  out = out.replace(/<\/div>\s*<div[^>]*>/gi, '\n\n');
  out = out.replace(/<\/li>\s*<li[^>]*>/gi, '\n');
  out = out.replace(/<p[^>]*>/gi, '');
  out = out.replace(/<\/p>/gi, '\n');
  out = out.replace(/<div[^>]*>/gi, '');
  out = out.replace(/<\/div>/gi, '\n');
  out = out.replace(/<li[^>]*>/gi, '- ');
  out = out.replace(/<\/li>/gi, '\n');
  out = out.replace(/<ul[^>]*>/gi, '');
  out = out.replace(/<\/ul>/gi, '\n');
  out = out.replace(/<ol[^>]*>/gi, '');
  out = out.replace(/<\/ol>/gi, '\n');

  // Strip remaining tags (e.g. strong, em, a)
  out = out.replace(/<[^>]+>/g, '');

  // Decode common entities
  out = out
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  return normalizeLines(out);
}
