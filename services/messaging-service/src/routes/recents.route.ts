import express, { RequestHandler } from "express";
import { authMiddleware } from "@jibbr/auth-middleware";
import { getRecents, touchRecent } from "../controllers/recents.controller.js";

const router = express.Router();

router.get("/", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, getRecents as unknown as RequestHandler);
router.post("/", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, touchRecent as unknown as RequestHandler);

export default router;
