/**
 * Convert TipTap/HTML message content to clean text for DB storage.
 * - Mention spans → @[label](id)
 * - <br> and block boundaries → newlines
 * - Strip all other tags, decode entities, normalize whitespace
 */
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

  // Block/line breaks → newlines
  out = out.replace(/<br\s*\/?>/gi, '\n');
  out = out.replace(/<\/p>\s*<p[^>]*>/gi, '\n\n');
  out = out.replace(/<\/div>\s*<div[^>]*>/gi, '\n\n');
  out = out.replace(/<\/li>\s*<li[^>]*>/gi, '\n');
  out = out.replace(/<p[^>]*>/gi, '');
  out = out.replace(/<\/p>/gi, '\n');
  out = out.replace(/<div[^>]*>/gi, '');
  out = out.replace(/<\/div>/gi, '\n');
  out = out.replace(/<li[^>]*>/gi, '• ');
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

  // Normalize whitespace
  out = out
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return out;
}
