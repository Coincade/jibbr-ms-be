import { describe, expect, it } from 'vitest';
import { shareFileRejection } from '../src/libs/shareable-file.js';

describe('shareFileRejection', () => {
  it('allows a voice note', () => {
    expect(
      shareFileRejection({ mimetype: 'audio/webm', originalname: 'voice-note.webm', size: 1000 })
    ).toBeNull();
  });

  it('rejects video by mime type and by extension', () => {
    expect(shareFileRejection({ mimetype: 'video/mp4', originalname: 'clip.mp4', size: 100 })).toBe(
      "Video files can't be shared in this workspace."
    );
    expect(
      shareFileRejection({ mimetype: 'application/octet-stream', originalname: 'clip.mp4', size: 100 })
    ).toBe("Video files can't be shared in this workspace.");
  });

  it('allows an unknown mime type when the extension is a shareable document', () => {
    expect(
      shareFileRejection({ mimetype: 'application/octet-stream', originalname: 'notes.pdf', size: 100 })
    ).toBeNull();
  });

  it('rejects a file type that cannot be shared', () => {
    expect(shareFileRejection({ mimetype: 'application/zip', originalname: 'bundle.zip', size: 100 })).toBe(
      "Other files can't be shared in this workspace."
    );
  });

  it('rejects a shareable file larger than 2MB', () => {
    expect(
      shareFileRejection({
        mimetype: 'application/pdf',
        originalname: 'big.pdf',
        size: 2 * 1024 * 1024 + 1,
      })
    ).toBe('File "big.pdf" is too large. Maximum size is 2MB');
  });
});
