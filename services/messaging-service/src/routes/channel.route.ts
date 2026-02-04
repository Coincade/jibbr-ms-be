import express, { RequestHandler } from "express";
import { createChannel, getWorkspaceChannels, getChannel, joinChannel, addMemberToChannel, updateChannel, softDeleteChannel, hardDeleteChannel, createBridgeChannel, inviteToBridgeChannel, acceptBridgeInvite, getBridgeChannels } from "../controllers/channel.controller.js";
import { authMiddleware } from "@jibbr/auth-middleware";

const router = express.Router();

// Create a new channel
router.post("/create", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, createChannel as unknown as RequestHandler);

// Bridge channels
router.post("/create-bridge", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, createBridgeChannel as unknown as RequestHandler);
router.get("/bridge-channels", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, getBridgeChannels as unknown as RequestHandler);
router.post("/accept-invite", acceptBridgeInvite as unknown as RequestHandler);

// Join a channel
router.post("/join", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, joinChannel as unknown as RequestHandler);

// Add member to private channel
router.post("/add-member", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, addMemberToChannel as unknown as RequestHandler);

// Invite to bridge channel (creator only)
router.post("/:channelId/invite", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, inviteToBridgeChannel as unknown as RequestHandler);

// Get all channels in a workspace
router.get("/workspace/:workspaceId", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, getWorkspaceChannels as unknown as RequestHandler);

// Update a channel
router.put("/:id", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, updateChannel as unknown as RequestHandler);

// Soft delete a channel (preserves messages and reactions)
router.delete("/:id/soft", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, softDeleteChannel as unknown as RequestHandler);

// Hard delete a channel (permanently removes everything - requires DELETE_PASS)
router.delete("/:id/hard", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, hardDeleteChannel as unknown as RequestHandler);

// Get a specific channel (this should be last to avoid catching other routes)
router.get("/:id", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, getChannel as unknown as RequestHandler);

export default router;