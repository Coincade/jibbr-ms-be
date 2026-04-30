import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('aws-sdk');
  vi.doUnmock('multer');
  delete process.env.DO_SPACES_ENDPOINT;
  delete process.env.DO_SPACES_KEY;
  delete process.env.DO_SPACES_SECRET;
  delete process.env.DO_SPACES_BUCKET;
});

describe('config/upload', () => {
  it('throws when DO_SPACES_BUCKET is missing for upload', async () => {
    const { uploadToSpaces } = await import('../src/config/upload.js');

    const file = {
      originalname: 'a.txt',
      buffer: Buffer.from('hello'),
      mimetype: 'text/plain',
    } as Express.Multer.File;

    await expect(uploadToSpaces(file)).rejects.toThrow(
      'DO_SPACES_BUCKET environment variable is not set'
    );
  });

  it('throws when DO_SPACES_BUCKET is missing for delete', async () => {
    const { deleteFromSpaces } = await import('../src/config/upload.js');
    await expect(deleteFromSpaces('https://cdn.example.com/folder/a.txt')).rejects.toThrow(
      'DO_SPACES_BUCKET environment variable is not set'
    );
  });

  it('uploadToSpaces resolves uploaded location on success', async () => {
    const send = vi.fn((cb: (err: unknown, result: { Location: string }) => void) =>
      cb(null, { Location: 'https://cdn.example.com/attachments/file.txt' })
    );
    const upload = vi.fn(() => ({ send }));
    const deleteObject = vi.fn();
    const S3 = vi.fn(function MockS3() {
      return { upload, deleteObject };
    });
    const Endpoint = vi.fn(function MockEndpoint() {
      return {};
    });
    vi.doMock('aws-sdk', () => ({
      default: { S3, Endpoint },
      S3,
      Endpoint,
    }));

    process.env.DO_SPACES_BUCKET = 'test-bucket';

    const { uploadToSpaces } = await import('../src/config/upload.js');

    const file = {
      originalname: 'a.txt',
      buffer: Buffer.from('hello'),
      mimetype: 'text/plain',
    } as Express.Multer.File;

    const url = await uploadToSpaces(file, 'attachments');

    expect(url).toBe('https://cdn.example.com/attachments/file.txt');
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'test-bucket',
        Body: file.buffer,
        ContentType: 'text/plain',
        ACL: 'public-read',
      })
    );
  });

  it('deleteFromSpaces resolves on success', async () => {
    const upload = vi.fn();
    const deleteObject = vi.fn((_params, cb: (err: unknown) => void) => cb(null));
    const S3 = vi.fn(function MockS3() {
      return { upload, deleteObject };
    });
    const Endpoint = vi.fn(function MockEndpoint() {
      return {};
    });
    vi.doMock('aws-sdk', () => ({
      default: { S3, Endpoint },
      S3,
      Endpoint,
    }));

    process.env.DO_SPACES_BUCKET = 'test-bucket';

    const { deleteFromSpaces } = await import('../src/config/upload.js');

    await expect(deleteFromSpaces('https://cdn.example.com/attachments/file.txt')).resolves.toBe(
      undefined
    );
    expect(deleteObject).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'test-bucket',
        Key: 'attachments/file.txt',
      }),
      expect.any(Function)
    );
  });
});
