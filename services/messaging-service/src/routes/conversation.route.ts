import express, { RequestHandler } from "express";
import { authMiddleware } from "@jibbr/auth-middleware";
// Note: File uploads should be handled via upload-service API
// For now, we'll keep a local upload config for backward compatibility
// TODO: Refactor to call upload-service API instead
import { upload } from "../config/upload.js";
import {
  getOrCreateConversation,
  getUserConversations,
  getConversationMessages,
  sendDirectMessage,
  sendDirectMessageWithAttachments,
  forwardToDirectMessage,
  deleteDirectMessage,
} from "../controllers/conversation.controller.js";

const router = express.Router();

// Get or create conversation between two users
router.get("/with/:targetUserId", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, getOrCreateConversation as unknown as RequestHandler);

// Get user's conversations
router.get("/", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, getUserConversations as unknown as RequestHandler);

// Get conversation messages
router.get("/:conversationId/messages", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, getConversationMessages as unknown as RequestHandler);

// Send direct message (text only)
router.post("/:conversationId/messages", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, sendDirectMessage as unknown as RequestHandler);

// Forward a message to this conversation (creates Message + ForwardedMessage)
router.post("/:conversationId/messages/forward", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, forwardToDirectMessage as unknown as RequestHandler);

// Send direct message with attachments
// Note: In production, files should be uploaded via upload-service first, then referenced here
router.post("/:conversationId/messages/with-attachments", 
  authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, 
  upload.array('attachments', 5) as unknown as RequestHandler,
  sendDirectMessageWithAttachments as unknown as RequestHandler
);

// Delete direct message (Soft Delete)
router.delete("/:conversationId/messages/:messageId", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, deleteDirectMessage as unknown as RequestHandler);

export default router; 