import { Router } from "express";
import { checkEmailRegistered, sendBridgeInviteEmail } from "../controllers/internal.controller.js";

const router = Router();

router.post("/check-email-registered", checkEmailRegistered);
router.post("/send-bridge-invite", sendBridgeInviteEmail);

export default router;
