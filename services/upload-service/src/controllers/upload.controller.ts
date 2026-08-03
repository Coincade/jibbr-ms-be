import { Request, Response } from 'express';
import multer from 'multer';
import { deleteFromSpaces, getSignedSpacesUrl, uploadToSpaces } from '../config/upload.js';

const ALLOWED_MIME_TYPES = new Set([
  // images
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  // documents
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // audio / video common chat attachments
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/webm',
  'audio/ogg',
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
    return;
  }
  cb(new Error(`File type not allowed: ${file.mimetype}`));
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 5 // Max 5 files
  }
});

// Profile picture: single image, max 10MB
const PROFILE_PICTURE_MAX_SIZE = 10 * 1024 * 1024;
const uploadProfilePicture = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PROFILE_PICTURE_MAX_SIZE, files: 1 },
});

/**
 * Upload files and return file references
 * POST /api/upload/files
 */
export const uploadFiles = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.files || req.files.length === 0) {
      res.status(400).json({
        message: 'No files provided',
        errors: { files: 'At least one file is required' }
      });
      return;
    }

    const files = req.files as Express.Multer.File[];
    const uploadedFiles = [];
    const uploadedUrls: string[] = [];

    // Upload each file to Digital Ocean Spaces
    for (const file of files) {
      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        await Promise.allSettled(uploadedUrls.map((url) => deleteFromSpaces(url)));
        res.status(400).json({
          message: 'Invalid file type',
          errors: { files: `File type not allowed: ${file.mimetype}` }
        });
        return;
      }

      try {
        const permanentUrl = await uploadToSpaces(file);
        uploadedUrls.push(permanentUrl);
        const fileId = `${Date.now()}-${Math.random().toString(36).substring(2)}`;
        const signedUrl = await getSignedSpacesUrl(permanentUrl);

        uploadedFiles.push({
          id: fileId,
          filename: file.originalname,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          url: signedUrl,
          storageUrl: permanentUrl,
          createdAt: new Date().toISOString()
        });
      } catch (error) {
        console.error('Error uploading file:', error);
        await Promise.allSettled(uploadedUrls.map((url) => deleteFromSpaces(url)));
        res.status(500).json({
          message: 'Failed to upload files',
          errors: { upload: 'File upload failed' }
        });
        return;
      }
    }

    res.status(200).json({
      message: 'Files uploaded successfully',
      data: {
        files: uploadedFiles
      }
    });

  } catch (error) {
    console.error('Upload error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    if (message.startsWith('File type not allowed')) {
      res.status(400).json({
        message: 'Invalid file type',
        errors: { files: message }
      });
      return;
    }
    res.status(500).json({
      message: 'Upload failed',
      errors: { upload: 'Internal server error' }
    });
  }
};

/**
 * Upload single profile picture (image only, max 10MB)
 * POST /api/upload/profile-picture
 * Field name: file
 */
export const uploadProfilePictureFile = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({
        message: 'No file provided',
        errors: { file: 'A single image file is required' }
      });
      return;
    }

    const allowed = /^image\/(jpeg|jpg|png|gif|webp)$/i.test(req.file.mimetype);
    if (!allowed) {
      res.status(400).json({
        message: 'Invalid file type',
        errors: { file: 'Only image files are allowed (PNG, JPG, GIF, WebP)' }
      });
      return;
    }

    const permanentUrl = await uploadToSpaces(req.file, 'profile-pictures');
    const signedUrl = await getSignedSpacesUrl(permanentUrl);
    res.status(200).json({
      message: 'Profile picture uploaded successfully',
      data: { url: signedUrl, storageUrl: permanentUrl }
    });
  } catch (error) {
    const err = error as Error;
    console.error('Profile picture upload error:', err);
    const isConfigError =
      !process.env.DO_SPACES_BUCKET ||
      !process.env.DO_SPACES_KEY ||
      !process.env.DO_SPACES_SECRET ||
      err.message?.includes('DO_SPACES') ||
      err.message?.includes('environment variable');
    const message = isConfigError
      ? 'Storage not configured. Set DO_SPACES_BUCKET, DO_SPACES_KEY, DO_SPACES_SECRET in upload-service .env.'
      : 'Failed to upload profile picture';
    res.status(500).json({
      message,
      errors: { upload: isConfigError ? 'Storage not configured' : 'Upload failed' }
    });
  }
};

/**
 * Get upload progress (for future implementation)
 * GET /api/upload/progress/:uploadId
 */
export const getUploadProgress = (req: Request, res: Response): void => {
  // This could be implemented with Redis or similar for tracking upload progress
  res.status(200).json({
    message: 'Upload progress',
    data: {
      uploadId: req.params.uploadId,
      progress: 100, // Placeholder
      status: 'completed'
    }
  });
};

export { upload, uploadProfilePicture };
