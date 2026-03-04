import { Request, Response } from 'express';
import multer from 'multer';
import { uploadToSpaces } from '../config/upload.js';

// Configure multer for memory storage - allow all file types
const upload = multer({
  storage: multer.memoryStorage(),
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

    // Upload each file to Digital Ocean Spaces
    for (const file of files) {
      try {
        const fileUrl = await uploadToSpaces(file);
        const fileId = `${Date.now()}-${Math.random().toString(36).substring(2)}`;
        
        uploadedFiles.push({
          id: fileId,
          filename: file.originalname,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          url: fileUrl,
          createdAt: new Date().toISOString()
        });
      } catch (error) {
        console.error('Error uploading file:', error);
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

    const fileUrl = await uploadToSpaces(req.file, 'profile-pictures');
    res.status(200).json({
      message: 'Profile picture uploaded successfully',
      data: { url: fileUrl }
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

