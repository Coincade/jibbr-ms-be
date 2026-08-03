import express, { RequestHandler, Request, Response } from 'express';
import { uploadFiles, getUploadProgress, upload, uploadProfilePictureFile, uploadProfilePicture } from '../controllers/upload.controller.js';
import { getSignedSpacesUrl } from '../config/upload.js';
import authMiddleware from '../middleware/Auth.middleware.js';

const router = express.Router();

router.post('/files',
  authMiddleware as unknown as RequestHandler,
  upload.array('files', 5) as unknown as RequestHandler,
  uploadFiles as unknown as RequestHandler
);

router.post('/profile-picture',
  authMiddleware as unknown as RequestHandler,
  uploadProfilePicture.single('file') as unknown as RequestHandler,
  uploadProfilePictureFile as unknown as RequestHandler
);

router.get('/progress/:uploadId',
  authMiddleware as unknown as RequestHandler,
  getUploadProgress as unknown as RequestHandler
);

/** Refresh a signed GET URL for a private Spaces object. */
router.post('/sign-url',
  authMiddleware as unknown as RequestHandler,
  (async (req: Request, res: Response) => {
    try {
      const url = typeof req.body?.url === 'string' ? req.body.url : '';
      if (!url) {
        res.status(400).json({ message: 'url is required' });
        return;
      }
      const signedUrl = await getSignedSpacesUrl(url);
      res.status(200).json({ message: 'Signed URL created', data: { url: signedUrl } });
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : 'Failed to sign URL',
      });
    }
  }) as unknown as RequestHandler
);

export default router;