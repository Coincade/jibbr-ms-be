import multer from 'multer';
import AWS from 'aws-sdk';

// Configure AWS SDK for Digital Ocean Spaces
const spacesEndpoint = new AWS.Endpoint(process.env.DO_SPACES_ENDPOINT || 'nyc3.digitaloceanspaces.com');
const s3 = new AWS.S3({
  endpoint: spacesEndpoint,
  accessKeyId: process.env.DO_SPACES_KEY,
  secretAccessKey: process.env.DO_SPACES_SECRET,
});

// Configure multer for memory storage
const storage = multer.memoryStorage();

// Configure multer - allow all file types
export const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 5 // Maximum 5 files per request
  }
});

// Upload file to Digital Ocean Spaces
export const uploadToSpaces = async (
  file: Express.Multer.File,
  folder: string = 'attachments'
): Promise<string> => {
  const bucketName = process.env.DO_SPACES_BUCKET;
  if (!bucketName) {
    throw new Error('DO_SPACES_BUCKET environment variable is not set');
  }

  const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).substring(2)}-${file.originalname}`;
  
  const params = {
    Bucket: bucketName,
    Key: fileName,
    Body: file.buffer,
    ContentType: file.mimetype,
    ACL: 'public-read',
  };

  try {
    return new Promise<string>((resolve, reject) => {
      (s3.upload(params) as any).send((err: any, result: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(result.Location);
        }
      });
    });
  } catch (error) {
    console.error('Error uploading to Digital Ocean Spaces:', error);
    throw new Error('Failed to upload file');
  }
};

// Delete file from Digital Ocean Spaces
export const deleteFromSpaces = async (fileUrl: string): Promise<void> => {
  const bucketName = process.env.DO_SPACES_BUCKET;
  if (!bucketName) {
    throw new Error('DO_SPACES_BUCKET environment variable is not set');
  }

  // Extract key from URL
  const urlParts = fileUrl.split('/');
  const key = urlParts.slice(-2).join('/'); // Get folder/filename

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