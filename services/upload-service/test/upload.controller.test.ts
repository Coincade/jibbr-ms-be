import { beforeEach, describe, expect, it, vi } from 'vitest';

const uploadToSpaces = vi.hoisted(() => vi.fn());

vi.mock('../src/config/upload.js', () => ({
  uploadToSpaces,
}));

import {
  getUploadProgress,
  uploadFiles,
  uploadProfilePictureFile,
} from '../src/controllers/upload.controller.js';

function createRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('upload.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploadFiles returns 400 without files', async () => {
    const res = createRes();
    await uploadFiles({ files: [] } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('uploadFiles returns uploaded file payload', async () => {
    const res = createRes();
    uploadToSpaces.mockResolvedValueOnce('https://cdn.example.com/f1');
    await uploadFiles(
      {
        files: [{ originalname: 'a.txt', mimetype: 'text/plain', size: 10, buffer: Buffer.from('a') }],
      } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { files: [expect.objectContaining({ url: 'https://cdn.example.com/f1' })] },
      })
    );
  });

  it('uploadFiles returns 500 when uploadToSpaces fails', async () => {
    const res = createRes();
    uploadToSpaces.mockRejectedValueOnce(new Error('boom'));
    await uploadFiles(
      {
        files: [{ originalname: 'a.txt', mimetype: 'text/plain', size: 10, buffer: Buffer.from('a') }],
      } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to upload files',
      })
    );
  });

  it('uploadProfilePictureFile rejects invalid mime type', async () => {
    const res = createRes();
    await uploadProfilePictureFile({ file: { mimetype: 'text/plain' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('uploadProfilePictureFile returns 400 without file', async () => {
    const res = createRes();
    await uploadProfilePictureFile({} as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('uploadProfilePictureFile uploads valid image', async () => {
    const res = createRes();
    uploadToSpaces.mockResolvedValueOnce('https://cdn.example.com/profile/u1.png');
    await uploadProfilePictureFile(
      { file: { mimetype: 'image/png', originalname: 'u1.png', buffer: Buffer.from('x') } } as any,
      res
    );
    expect(uploadToSpaces).toHaveBeenCalledWith(expect.any(Object), 'profile-pictures');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('uploadProfilePictureFile returns storage-not-configured message on config errors', async () => {
    const res = createRes();
    uploadToSpaces.mockRejectedValueOnce(new Error('DO_SPACES_BUCKET environment variable is not set'));
    await uploadProfilePictureFile(
      { file: { mimetype: 'image/png', originalname: 'u1.png', buffer: Buffer.from('x') } } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Storage not configured'),
      })
    );
  });

  it('uploadProfilePictureFile returns generic upload message on non-config errors', async () => {
    const res = createRes();
    process.env.DO_SPACES_BUCKET = 'bucket';
    process.env.DO_SPACES_KEY = 'key';
    process.env.DO_SPACES_SECRET = 'secret';
    uploadToSpaces.mockRejectedValueOnce(new Error('network timeout'));
    await uploadProfilePictureFile(
      { file: { mimetype: 'image/png', originalname: 'u1.png', buffer: Buffer.from('x') } } as any,
      res
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to upload profile picture',
      })
    );
  });

  it('getUploadProgress returns placeholder progress payload', () => {
    const res = createRes();
    getUploadProgress({ params: { uploadId: 'up-1' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ uploadId: 'up-1', progress: 100, status: 'completed' }),
      })
    );
  });
});
