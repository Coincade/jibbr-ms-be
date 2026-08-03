import multer from 'multer';
import AWS from 'aws-sdk';

// Configure AWS SDK for Digital Ocean Spaces
const spacesEndpoint = new AWS.Endpoint(process.env.DO_SPACES_ENDPOINT || 'nyc3.digitaloceanspaces.com');
const s3 = new AWS.S3({
  endpoint: spacesEndpoint,
  accessKeyId: process.env.DO_SPACES_KEY,
  secretAccessKey: process.env.DO_SPACES_SECRET,
  signatureVersion: 'v4',
  s3ForcePathStyle: false,
});

const SIGNED_URL_EXPIRES_SECONDS = Number.parseInt(
  process.env.SPACES_SIGNED_URL_EXPIRES_SECONDS || String(60 * 60 * 24 * 7), // 7 days
  10
);

const storage = multer.memoryStorage();

const sanitizeOriginalName = (name: string): string =>
  name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);

export const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 5 // Maximum 5 files per request
  }
});

const getBucketName = (): string => {
  const bucketName = process.env.DO_SPACES_BUCKET;
  if (!bucketName) {
    throw new Error('DO_SPACES_BUCKET environment variable is not set');
  }
  return bucketName;
};

const getEndpointHost = (): string =>
  (process.env.DO_SPACES_ENDPOINT || 'nyc3.digitaloceanspaces.com').replace(/^https?:\/\//, '');

/** Stable object URL (no signature) for DB storage. */
export const buildPermanentSpacesUrl = (key: string): string => {
  const cdn = process.env.DO_SPACES_CDN_ENDPOINT?.replace(/\/$/, '');
  if (cdn) return `${cdn}/${key}`;
  return `https://${getBucketName()}.${getEndpointHost()}/${key}`;
};

export const keyFromSpacesUrl = (fileUrl: string): string | null => {
  try {
    const parsed = new URL(fileUrl);
    const path = parsed.pathname.replace(/^\/+/, '');
    const bucket = process.env.DO_SPACES_BUCKET || '';
    if (bucket && path.startsWith(`${bucket}/`)) {
      return path.slice(bucket.length + 1);
    }
    const parts = path.split('/').filter(Boolean);
    if (parts.length >= 2) return parts.slice(-2).join('/');
    return parts[0] || null;
  } catch {
    const urlParts = fileUrl.split('/');
    return urlParts.slice(-2).join('/') || null;
  }
};

/** Create a time-limited signed GET URL for a private Spaces object. */
export const getSignedSpacesUrl = async (
  fileUrlOrKey: string,
  expiresInSeconds: number = SIGNED_URL_EXPIRES_SECONDS
): Promise<string> => {
  if (!fileUrlOrKey) return fileUrlOrKey;
  // Already signed (or non-Spaces) — re-sign from key when it looks like Spaces
  const bucketName = getBucketName();
  const key = fileUrlOrKey.includes('://')
    ? keyFromSpacesUrl(fileUrlOrKey)
    : fileUrlOrKey;
  if (!key) return fileUrlOrKey;

  return s3.getSignedUrlPromise('getObject', {
    Bucket: bucketName,
    Key: key,
    Expires: expiresInSeconds,
  });
};

export const signAttachmentUrls = async <T extends { url?: string | null }>(
  attachments: T[] | null | undefined
): Promise<T[]> => {
  if (!attachments?.length) return attachments ?? [];
  return Promise.all(
    attachments.map(async (att) => {
      if (!att?.url) return att;
      try {
        return { ...att, url: await getSignedSpacesUrl(att.url) };
      } catch {
        return att;
      }
    })
  );
};

// Upload file to Digital Ocean Spaces (private). Returns permanent URL for storage.
export const uploadToSpaces = async (
  file: Express.Multer.File,
  folder: string = 'attachments'
): Promise<string> => {
  const bucketName = getBucketName();
  const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).substring(2)}-${sanitizeOriginalName(file.originalname)}`;

  const params = {
    Bucket: bucketName,
    Key: fileName,
    Body: file.buffer,
    ContentType: file.mimetype,
    ACL: 'private' as const,
  };

  try {
    await new Promise<void>((resolve, reject) => {
      (s3.upload(params) as any).send((err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
    return buildPermanentSpacesUrl(fileName);
  } catch (error) {
    console.error('Error uploading to Digital Ocean Spaces:', error);
    throw new Error('Failed to upload file');
  }
};

export const deleteFromSpaces = async (fileUrl: string): Promise<void> => {
  const bucketName = getBucketName();
  const key = keyFromSpacesUrl(fileUrl);
  if (!key) {
    throw new Error('Could not derive object key from URL');
  }

  const params = {
    Bucket: bucketName,
    Key: key,
  };

  try {
    return new Promise<void>((resolve, reject) => {
      s3.deleteObject(params, (err: any) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  } catch (error) {
    console.error('Error deleting from Digital Ocean Spaces:', error);
    throw new Error('Failed to delete file');
  }
};

export default upload;
