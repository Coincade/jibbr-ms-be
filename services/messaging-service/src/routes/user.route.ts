// [mentions] User routes
import express, { RequestHandler } from "express";
import { authMiddleware } from "@jibbr/auth-middleware";
import { searchUsers } from "../controllers/user.controller.js";

const router = express.Router();

// Search users in a channel (for mentions)
router.get("/search", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, searchUsers as unknown as RequestHandler);

export default router;

