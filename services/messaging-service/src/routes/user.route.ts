// [mentions] User routes + user status
import express, { RequestHandler } from "express";
import { authMiddleware } from "@jibbr/auth-middleware";
import {
  searchCollaborators,
  searchUsers,
  updateMyStatus,
  getMyStatus,
  getUserStatus,
  updateMyTimezone,
  getMe,
  updateMe,
  getUserProfile,
} from "../controllers/user.controller.js";
import { collaboratorSearchLimiter } from "../config/rateLimit.js";

const router = express.Router();
const auth = authMiddleware(process.env.JWT_SECRET!);

// Search users in a channel (for mentions)
router.get("/search", auth as unknown as RequestHandler, searchUsers as unknown as RequestHandler);
router.get(
  "/search-collaborators",
  auth as unknown as RequestHandler,
  collaboratorSearchLimiter as unknown as RequestHandler,
  searchCollaborators as unknown as RequestHandler
);

// Current user profile (must be before /:userId)
router.get("/me", auth as unknown as RequestHandler, getMe as unknown as RequestHandler);
router.patch("/me", auth as unknown as RequestHandler, updateMe as unknown as RequestHandler);

// User presence status (must be before /:userId to match /me first)
router.patch("/me/status", auth as unknown as RequestHandler, updateMyStatus as unknown as RequestHandler);
router.get("/me/status", auth as unknown as RequestHandler, getMyStatus as unknown as RequestHandler);
router.get("/:userId/profile", auth as unknown as RequestHandler, getUserProfile as unknown as RequestHandler);
router.get("/:userId/status", auth as unknown as RequestHandler, getUserStatus as unknown as RequestHandler);
router.patch("/me/timezone", auth as unknown as RequestHandler, updateMyTimezone as unknown as RequestHandler);

export default router;

