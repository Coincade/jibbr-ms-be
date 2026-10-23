import express, { RequestHandler } from "express";
import { authMiddleware } from "@jibbr/auth-middleware";
import { getStarboard, replaceStarboard } from "../controllers/starboard.controller.js";

const router = express.Router();
const auth = authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler;

router.get("/", auth, getStarboard as unknown as RequestHandler);
router.put("/", auth, replaceStarboard as unknown as RequestHandler);

export default router;
