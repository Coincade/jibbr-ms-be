import { describe, expect, it } from 'vitest';
import {
  defaultFileSharePolicy,
  mergeFileSharePolicies,
  normalizeFileSharePolicy,
  shareFileRejection,
} from './file-share-policy';

describe('file share policy', () => {
  it('keeps the previous default: documents and images, 2MB, no video', () => {
    const policy = defaultFileSharePolicy();
    expect(shareFileRejection({ mimetype: 'application/pdf', originalname: 'notes.pdf', size: 100 }, policy)).toBeNull();
    expect(shareFileRejection({ mimetype: 'video/mp4', originalname: 'clip.mp4', size: 100 }, policy)).toMatch(/Video/);
    expect(
      shareFileRejection({ mimetype: 'application/pdf', originalname: 'big.pdf', size: 2 * 1024 * 1024 + 1 }, policy)
    ).toMatch(/2MB/);
  });

  it('allows a video and a 10MB file when the workspace says so', () => {
    const policy = normalizeFileSharePolicy({ fileUploadMaxMb: 10, allowedFileTypes: ['video', 'pdf'] });
    expect(shareFileRejection({ mimetype: 'video/mp4', originalname: 'clip.mp4', size: 9 * 1024 * 1024 }, policy)).toBeNull();
    expect(shareFileRejection({ mimetype: 'image/png', originalname: 'shot.png', size: 100 }, policy)).toMatch(/Image/);
  });

  it('uses the stricter limit when two workspaces are in a conversation', () => {
    const merged = mergeFileSharePolicies([
      { maxMb: 20, types: ['pdf', 'video'] },
      { maxMb: 5, types: ['pdf', 'word'] },
    ]);
    expect(merged).toEqual({ maxMb: 5, types: ['pdf'] });
  });

  it('ignores a size that is not one of the admin options', () => {
    expect(normalizeFileSharePolicy({ fileUploadMaxMb: 15 }).maxMb).toBe(2);
  });
});
