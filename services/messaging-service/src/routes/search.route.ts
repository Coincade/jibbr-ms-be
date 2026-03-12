import express, { RequestHandler } from 'express';
import { search } from '../controllers/search.controller.js';
import { authMiddleware } from '@jibbr/auth-middleware';

const router = express.Router();

router.get(
  '/',
  authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler,
  search as unknown as RequestHandler
);

export default router;
