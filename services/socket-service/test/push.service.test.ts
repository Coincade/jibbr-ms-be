import { beforeEach, describe, expect, it, vi } from 'vitest';
import PushService from '../src/services/push.service.js';

describe('PushService', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('skips tokens that are not Expo push tokens', async () => {
    await expect(
      PushService.sendToTokens(['not-a-token'], { title: 'Hi', body: 'There' })
    ).resolves.toBeUndefined();
  });
});
