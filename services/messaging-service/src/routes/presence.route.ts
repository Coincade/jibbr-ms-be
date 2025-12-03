import express, { RequestHandler } from "express";
import { getOnlineUsersList, checkUserOnlineStatus, checkMultipleUsersStatus, getOnlineStats } from "../controllers/presence.controller.js";
import { authMiddleware } from "@jibbr/auth-middleware";

const router = express.Router();

// Get list of all online users
router.get("/online", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, getOnlineUsersList as unknown as RequestHandler);

// Check if a specific user is online
router.get("/online/:userId", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, checkUserOnlineStatus as unknown as RequestHandler);

// Check online status for multiple users
router.post("/online/check-multiple", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, checkMultipleUsersStatus as unknown as RequestHandler);

// Get online statistics
router.get("/stats", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, getOnlineStats as unknown as RequestHandler);

export default router;
