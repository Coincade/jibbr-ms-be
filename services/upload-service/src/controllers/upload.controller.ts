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

export { upload };

