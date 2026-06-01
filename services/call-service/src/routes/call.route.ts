import { Router, type RequestHandler } from 'express';
import { authMiddleware } from '@jibbr/auth-middleware';
import {
  joinChannelCall,
  joinConversationCall,
  leaveChannelCall,
  leaveConversationCall,
  getChannelCall,
  getConversationCall,
  endChannelCall,
  endConversationCall,
  updateCallMediaState,
  listWorkspaceHuddleHistory,
  createWebRtcTransport,
  connectWebRtcTransport,
  produce,
  consume,
  resumeConsumer,
} from '../controllers/call.controller.js';
import { callRateLimit } from '../middleware/rate-limit.middleware.js';

const router = Router();
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error('JWT_SECRET is required for call-service');
}

const auth = authMiddleware(jwtSecret) as unknown as RequestHandler;

router.use(callRateLimit);

router.post('/channels/:channelId/call/join', auth, joinChannelCall);
router.post('/channels/:channelId/call/leave', auth, leaveChannelCall);
router.get('/channels/:channelId/call', auth, getChannelCall);
router.post('/channels/:channelId/call/end', auth, endChannelCall);

router.post('/conversations/:conversationId/call/join', auth, joinConversationCall);
router.post('/conversations/:conversationId/call/leave', auth, leaveConversationCall);
router.get('/conversations/:conversationId/call', auth, getConversationCall);
router.post('/conversations/:conversationId/call/end', auth, endConversationCall);

router.post('/call/media-state', auth, updateCallMediaState);
router.get('/workspaces/:workspaceId/huddles/history', auth, listWorkspaceHuddleHistory);

router.post('/call/transport', auth, createWebRtcTransport);
router.post('/call/transport/:transportId/connect', auth, connectWebRtcTransport);
router.post('/call/produce', auth, produce);
router.post('/call/consume', auth, consume);
router.post('/call/consumers/:consumerId/resume', auth, resumeConsumer);

export default router;
