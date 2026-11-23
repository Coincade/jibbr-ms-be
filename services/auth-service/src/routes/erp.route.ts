import express, { RequestHandler } from 'express';
import { askErp, connectErp, disconnectErpSession, erpStatus } from '../controllers/erp.controller.js';
import authMiddleware from '../middleware/Auth.middleware.js';

const router = express.Router();

router.post('/connect', authMiddleware as unknown as RequestHandler, connectErp as unknown as RequestHandler);
router.get('/status', authMiddleware as unknown as RequestHandler, erpStatus as unknown as RequestHandler);
router.post('/disconnect', authMiddleware as unknown as RequestHandler, disconnectErpSession as unknown as RequestHandler);
router.post('/ask/stream', authMiddleware as unknown as RequestHandler, askErp as unknown as RequestHandler);

export default router;
