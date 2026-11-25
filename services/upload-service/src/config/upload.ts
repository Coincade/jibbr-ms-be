import multer from 'multer';
import AWS from 'aws-sdk';

const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
};

/** Finder drag-and-drop often leaves mimetype empty. Spaces rejects a blank Content-Type. */
export const contentTypeFor = (file: { mimetype?: string; originalname?: string }): string => {
  const mime = (file.mimetype || '').toLowerCase();
  const generic = mime === '' || mime === 'application/octet-stream' || mime === 'text/plain';
  if (!generic) return mime;
  const ext = (file.originalname || '').split('.').pop()?.toLowerCase() || '';
  return EXT_MIME[ext] || mime || 'application/octet-stream';
};

let s3Client: AWS.S3 | null = null;

const spacesRegion = (): string => {
  const configured = process.env.DO_SPACES_REGION?.trim();
  if (configured) return configured;
  const label = getEndpointHost().split('.')[0];
  return label && label !== 'digitaloceanspaces' ? label : 'us-east-1';
};

/**
 * Built on first use, not at import. The service loads dotenv after the import
 * graph, so a client created at module scope never sees DO_SPACES_KEY/SECRET.
 */
const getS3 = (): AWS.S3 => {
  if (!s3Client) {
    s3Client = new AWS.S3({
      endpoint: new AWS.Endpoint(getEndpointHost()),
      accessKeyId: process.env.DO_SPACES_KEY,
      secretAccessKey: process.env.DO_SPACES_SECRET,
      region: spacesRegion(),
      signatureVersion: 'v4',
      s3ForcePathStyle: false,
    });
  }
  return s3Client;
};

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

  return getS3().getSignedUrlPromise('getObject', {
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
    ContentType: contentTypeFor(file),
    ACL: 'private' as const,
  };

  try {
    await new Promise<void>((resolve, reject) => {
      (getS3().upload(params) as any).send((err: any) => {
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
      getS3().deleteObject(params, (err: any) => {
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
