// [mentions] Parse mentions from TipTap HTML or ProseMirror JSON

interface MentionNode {
  type: 'mention';
  attrs: {
    id: string;
    username: string;
    type: 'user' | 'channel' | 'here' | 'everyone';
    label?: string;
  };
}

interface ProseMirrorNode {
  type: string;
  attrs?: Record<string, any>;
  content?: ProseMirrorNode[];
}

/**
 * Extract unique user mentions from ProseMirror JSON
 */
export function parseMentionsFromJSON(json: any): Array<{ userId: string; username: string }> {
  if (!json || typeof json !== 'object') {
    return [];
  }

  const mentions: Map<string, { userId: string; username: string }> = new Map();

  function walkNode(node: ProseMirrorNode): void {
    if (!node || typeof node !== 'object') return;

    // Check if this is a mention node (frontend uses label, backend historically used username)
    if (node.type === 'mention' && node.attrs) {
      const attrs = node.attrs;
      const name = attrs.username ?? attrs.label;
      if (attrs.type === 'user' && attrs.id && name) {
        mentions.set(attrs.id, {
          userId: attrs.id,
          username: String(name)
        });
      }
    }

    // Recursively walk children
    if (Array.isArray(node.content)) {
      node.content.forEach(walkNode);
    }
  }

  // Walk the document structure
  if (json.content && Array.isArray(json.content)) {
    json.content.forEach(walkNode);
  } else if (json.type) {
    walkNode(json);
  }

  return Array.from(mentions.values());
}

/**
 * Extract mentions from HTML by parsing mention spans
 * Fallback method when JSON is not available
 */
export function parseMentionsFromHTML(html: string): Array<{ userId: string; username: string }> {
  if (!html || typeof html !== 'string') {
    return [];
  }

  const mentions: Map<string, { userId: string; username: string }> = new Map();

  // Frontend emits data-id and data-label (TipTap mention node); support data-username for backward compatibility.
  const patterns = [
    /<span[^>]*class=["']mention["'][^>]*data-id=["']([^"']+)["'][^>]*data-label=["']([^"']+)["'][^>]*>/gi,
    /<span[^>]*class=["']mention["'][^>]*data-label=["']([^"']+)["'][^>]*data-id=["']([^"']+)["'][^>]*>/gi,
    /<span[^>]*data-id=["']([^"']+)["'][^>]*data-username=["']([^"']+)["'][^>]*>/gi,
  ];

  let match;
  for (const re of patterns) {
    re.lastIndex = 0;
    while ((match = re.exec(html)) !== null) {
      const isLabelFirst = re === patterns[1];
      const userId = isLabelFirst ? match[2] : match[1];
      const username = isLabelFirst ? match[1] : match[2];
      if (userId && username) mentions.set(userId, { userId, username });
    }
  }

  // Also try regex fallback for plain @username patterns (if HTML parsing fails)
  if (mentions.size === 0) {
    const plainMentionRegex = /@(\w+)/g;
    let plainMatch;
    while ((plainMatch = plainMentionRegex.exec(html)) !== null) {
      const username = plainMatch[1];
      // Note: This won't have userId, would need to resolve via username lookup
      // For now, we'll rely on the HTML span parsing above
    }
  }

  return Array.from(mentions.values());
}

/**
 * Main function: parse mentions from content (prefer JSON, fallback to HTML)
 */
export function parseMentions(content: string, jsonContent?: any): Array<{ userId: string; username: string }> {
  // Try JSON first (preferred)
  if (jsonContent) {
    const jsonMentions = parseMentionsFromJSON(jsonContent);
    if (jsonMentions.length > 0) {
      return jsonMentions;
    }
  }

  // Fallback to HTML parsing
  return parseMentionsFromHTML(content);
}

