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
  listWorkspaceHuddlesLive,
  listChannelHuddlesHistory,
  createWebRtcTransport,
  connectWebRtcTransport,
  produce,
  consume,
  resumeConsumer,
  pauseProducer,
  resumeProducer,
  setConsumerLayers,
  recordCallStats,
} from '../controllers/call.controller.js';
import { burstRateLimit, standardRateLimit, relaxedRateLimit } from '../middleware/rate-limit.middleware.js';

const router = Router();
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error('JWT_SECRET is required for call-service');
}

const auth = authMiddleware(jwtSecret) as unknown as RequestHandler;

// Join/transport operations get a burst allowance (many requests on call setup)
router.post('/channels/:channelId/call/join', burstRateLimit, auth, joinChannelCall);
router.post('/conversations/:conversationId/call/join', burstRateLimit, auth, joinConversationCall);
router.post('/call/transport', burstRateLimit, auth, createWebRtcTransport);
router.post('/call/transport/:transportId/connect', burstRateLimit, auth, connectWebRtcTransport);
router.post('/call/produce', burstRateLimit, auth, produce);
router.post('/call/consume', burstRateLimit, auth, consume);
router.post('/call/consumers/:consumerId/resume', burstRateLimit, auth, resumeConsumer);

// Standard operations
router.post('/channels/:channelId/call/leave', standardRateLimit, auth, leaveChannelCall);
router.get('/channels/:channelId/call', standardRateLimit, auth, getChannelCall);
router.post('/channels/:channelId/call/end', standardRateLimit, auth, endChannelCall);
router.post('/conversations/:conversationId/call/leave', standardRateLimit, auth, leaveConversationCall);
router.get('/conversations/:conversationId/call', standardRateLimit, auth, getConversationCall);
router.post('/conversations/:conversationId/call/end', standardRateLimit, auth, endConversationCall);
router.get('/workspaces/:workspaceId/huddles/history', standardRateLimit, auth, listWorkspaceHuddleHistory);
router.get('/workspaces/:workspaceId/huddles/live', standardRateLimit, auth, listWorkspaceHuddlesLive);
router.get('/channels/:channelId/huddles/history', standardRateLimit, auth, listChannelHuddlesHistory);
router.post('/call/producer/:producerId/pause', standardRateLimit, auth, pauseProducer);
router.post('/call/producer/:producerId/resume', standardRateLimit, auth, resumeProducer);
router.post('/call/consumer/:consumerId/layers', standardRateLimit, auth, setConsumerLayers);

// Relaxed limits for high-frequency fire-and-forget endpoints
router.post('/call/media-state', relaxedRateLimit, auth, updateCallMediaState);
router.post('/call/stats', relaxedRateLimit, auth, recordCallStats);

export default router;
