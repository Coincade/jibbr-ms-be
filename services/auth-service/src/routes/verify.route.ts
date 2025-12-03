import { Router } from "express";
import { verifyEmail, verifyError } from "../controllers/auth.controller.js";

const router = Router();

router.get("/verify-email", verifyEmail);
router.get("/verify-error", verifyError);

export default router;
