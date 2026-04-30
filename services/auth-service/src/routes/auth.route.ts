import express, { RequestHandler } from "express";
import { login, logout, register, getUser, forgetPassword, forgetResetPassword, resetPassword, deleteUser, resendVerificationEmail } from "../controllers/auth.controller.js";
import authMiddleware from "../middleware/Auth.middleware.js";

const router = express.Router();

router.post("/register", register as unknown as RequestHandler);
router.post("/login", login as unknown as RequestHandler);
router.post("/logout", logout as unknown as RequestHandler);

//Email Verification Routes
router.post("/resend-verification", resendVerificationEmail as unknown as RequestHandler);

//Password Routes
router.post("/forget-password", forgetPassword as unknown as RequestHandler);
router.post("/forget-reset-password", forgetResetPassword as unknown as RequestHandler);
router.post("/reset-password", resetPassword as unknown as RequestHandler);

//Private User Routes
router.get("/user", authMiddleware as unknown as RequestHandler, getUser as unknown as RequestHandler);

// Admin Routes - Delete user (only for admins)
router.delete("/user/:id", authMiddleware as unknown as RequestHandler, deleteUser as unknown as RequestHandler);

export default router;
