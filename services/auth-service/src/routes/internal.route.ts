import { Router } from "express";
import { sendBridgeInviteEmail } from "../controllers/internal.controller.js";

const router = Router();

router.post("/send-bridge-invite", sendBridgeInviteEmail);

export default router;
