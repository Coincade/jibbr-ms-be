import express, { RequestHandler } from 'express';
import { uploadFiles, getUploadProgress, upload } from '../controllers/upload.controller.js';
import authMiddleware from '../middleware/Auth.middleware.js';

const router = express.Router();

router.post('/files', 
  authMiddleware as unknown as RequestHandler, 
  upload.array('files', 5) as unknown as RequestHandler, 
  uploadFiles as unknown as RequestHandler
);

router.get('/progress/:uploadId', 
  authMiddleware as unknown as RequestHandler, 
  getUploadProgress as unknown as RequestHandler
);

export default router; 