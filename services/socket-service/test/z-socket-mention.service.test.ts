import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('socket mention.service', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns sanitized content and no user ids when there is no channel', async () => {
    const { processMentions } = await vi.importActual<typeof import('../src/services/mention.service.js')>(
      '../src/services/mention.service.js'
    );
    const result = await processMentions('<p>hello</p>', 'u1', null);
    expect(result.mentionedUserIds).toEqual([]);
    expect(result.sanitizedContent).toContain('hello');
  });

  it('collects a user mention from json without querying special mentions', async () => {
    const { processMentions } = await vi.importActual<typeof import('../src/services/mention.service.js')>(
      '../src/services/mention.service.js'
    );
    const result = await processMentions('<p>hi</p>', 'u1', null, {
      type: 'doc',
      content: [{ type: 'mention', attrs: { id: 'u2', type: 'user', username: 'Ada' } }],
    });
    expect(result.mentionedUserIds).toEqual(['u2']);
  });

  it('swallows unread-count failures for a channel member', async () => {
    const { NotificationService } = await vi.importActual<
      typeof import('../src/services/notification.service.js')
    >('../src/services/notification.service.js');
    await expect(NotificationService.incrementChannelUnreadCount('c1', 'u1')).resolves.toBeUndefined();
  });
});
