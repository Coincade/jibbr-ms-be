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

    // Check if this is a mention node
    if (node.type === 'mention' && node.attrs) {
      const attrs = node.attrs;
      if (attrs.type === 'user' && attrs.id && attrs.username) {
        // Dedupe by userId
        mentions.set(attrs.id, {
          userId: attrs.id,
          username: attrs.username
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
  
  // Regex to match mention spans: <span class="mention" data-id="..." data-username="...">@username</span>
  const mentionRegex = /<span[^>]*class=["']mention["'][^>]*data-id=["']([^"']+)["'][^>]*data-username=["']([^"']+)["'][^>]*>/gi;
  
  let match;
  while ((match = mentionRegex.exec(html)) !== null) {
    const userId = match[1];
    const username = match[2];
    if (userId && username) {
      mentions.set(userId, { userId, username });
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

