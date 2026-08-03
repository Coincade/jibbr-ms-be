import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('aws-sdk');
  delete process.env.DO_SPACES_ENDPOINT;
  delete process.env.DO_SPACES_KEY;
  delete process.env.DO_SPACES_SECRET;
  delete process.env.DO_SPACES_BUCKET;
  delete process.env.DO_SPACES_CDN_ENDPOINT;
});

describe('config/upload', () => {
  it('throws when DO_SPACES_BUCKET is missing for upload', async () => {
    const { uploadToSpaces } = await import('../src/config/upload.js');
    await expect(
      uploadToSpaces({
        originalname: 'a.txt',
        buffer: Buffer.from('x'),
        mimetype: 'text/plain',
      } as Express.Multer.File)
    ).rejects.toThrow('DO_SPACES_BUCKET environment variable is not set');
  });

  it('uploadToSpaces resolves permanent URL on success', async () => {
    const send = vi.fn((cb: (err: unknown) => void) => cb(null));
    const upload = vi.fn(() => ({ send }));
    const deleteObject = vi.fn();
    const S3 = vi.fn(function MockS3() {
      return { upload, deleteObject };
    });
    const Endpoint = vi.fn(function MockEndpoint() {
      return {};
    });
    vi.doMock('aws-sdk', () => ({ default: { S3, Endpoint }, S3, Endpoint }));

    process.env.DO_SPACES_BUCKET = 'bucket';
    process.env.DO_SPACES_CDN_ENDPOINT = 'https://cdn.example.com';
    const { uploadToSpaces } = await import('../src/config/upload.js');
    const result = await uploadToSpaces(
      { originalname: 'a.txt', buffer: Buffer.from('x'), mimetype: 'text/plain' } as any
    );
    expect(result).toMatch(/^https:\/\/cdn\.example\.com\/attachments\/.+-a\.txt$/);
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({
        ACL: 'private',
        Bucket: 'bucket',
        ContentType: 'text/plain',
      })
    );
  });

  it('uploadToSpaces rejects when S3 upload callback returns error', async () => {
    const send = vi.fn((cb: (err: unknown, result?: { Location: string }) => void) =>
      cb(new Error('s3 failed'))
    );
    const upload = vi.fn(() => ({ send }));
    const deleteObject = vi.fn();
    const S3 = vi.fn(function MockS3() {
      return { upload, deleteObject };
    });
    const Endpoint = vi.fn(function MockEndpoint() {
      return {};
    });
    vi.doMock('aws-sdk', () => ({ default: { S3, Endpoint }, S3, Endpoint }));

    process.env.DO_SPACES_BUCKET = 'bucket';
    const { uploadToSpaces } = await import('../src/config/upload.js');
    await expect(
      uploadToSpaces({
        originalname: 'a.txt',
        buffer: Buffer.from('x'),
        mimetype: 'text/plain',
      } as any)
    ).rejects.toThrow('Failed to upload file');
  });

  it('deleteFromSpaces throws when bucket env is missing', async () => {
    const { deleteFromSpaces } = await import('../src/config/upload.js');
    await expect(
      deleteFromSpaces('https://cdn.example.com/attachments/file.txt')
    ).rejects.toThrow('DO_SPACES_BUCKET environment variable is not set');
  });

  it('deleteFromSpaces resolves on success', async () => {
    const upload = vi.fn();
    const deleteObject = vi.fn((_params: unknown, cb: (err: unknown) => void) => cb(null));
    const S3 = vi.fn(function MockS3() {
      return { upload, deleteObject };
    });
    const Endpoint = vi.fn(function MockEndpoint() {
      return {};
    });
    vi.doMock('aws-sdk', () => ({ default: { S3, Endpoint }, S3, Endpoint }));

    process.env.DO_SPACES_BUCKET = 'bucket';
    const { deleteFromSpaces } = await import('../src/config/upload.js');
    await expect(
      deleteFromSpaces('https://cdn.example.com/attachments/file.txt')
    ).resolves.toBeUndefined();
    expect(deleteObject).toHaveBeenCalled();
  });

  it('deleteFromSpaces rejects when delete callback returns error', async () => {
    const upload = vi.fn();
    const deleteObject = vi.fn((_params: unknown, cb: (err: unknown) => void) =>
      cb(new Error('delete failed'))
    );
    const S3 = vi.fn(function MockS3() {
      return { upload, deleteObject };
    });
    const Endpoint = vi.fn(function MockEndpoint() {
      return {};
    });
    vi.doMock('aws-sdk', () => ({ default: { S3, Endpoint }, S3, Endpoint }));

    process.env.DO_SPACES_BUCKET = 'bucket';
    const { deleteFromSpaces } = await import('../src/config/upload.js');
    await expect(
      deleteFromSpaces('https://cdn.example.com/attachments/file.txt')
    ).rejects.toThrow('delete failed');
  });
});
