// [mentions] HTML sanitization for message content
// @ts-ignore - sanitize-html doesn't have perfect TypeScript types
import sanitizeHtml from 'sanitize-html';

/**
 * Sanitize HTML content while preserving mention spans
 */
export function sanitizeMessageHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre', 'ul', 'ol', 'li',
      'a', 'blockquote', 'span' // span for mentions
    ],
    allowedAttributes: {
      'a': ['href', 'title'],
      'span': ['class', 'data-id', 'data-type', 'data-username', 'data-label'], // [mentions]
      'code': ['class'],
      'pre': ['class']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    // Preserve mention spans
    transformTags: {
      'span': (tagName: string, attribs: Record<string, string>) => {
        // Only preserve span if it's a mention
        if (attribs.class === 'mention' || attribs['data-type'] === 'user') {
          return {
            tagName: 'span',
            attribs: {
              class: attribs.class || 'mention',
              'data-id': attribs['data-id'] || '',
              'data-type': attribs['data-type'] || 'user',
              'data-username': attribs['data-username'] || '',
              'data-label': attribs['data-label'] || ''
            }
          } as any;
        }
        // Remove non-mention spans by returning empty tag
        return { tagName: '' } as any;
      }
    }
  });
}

