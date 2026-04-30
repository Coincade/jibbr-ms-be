import express, { RequestHandler } from "express";
import { authMiddleware } from "@jibbr/auth-middleware";
import {
  approveCollaborationRequest,
  createCollaborationRequest,
  createExternalDirectMessage,
  createSharedChannel,
  getCollaborationRequestInbox,
  getCollaborationRequestOutbox,
  listWorkspaceCollaborations,
  rejectCollaborationRequest,
  revokeCollaborationLink,
} from "../controllers/workspace-collaboration.controller.js";

const router = express.Router();

router.post(
  "/requests",
  authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler,
  createCollaborationRequest as unknown as RequestHandler
);
router.get(
  "/requests/inbox",
  authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler,
  getCollaborationRequestInbox as unknown as RequestHandler
);
router.get(
  "/requests/outbox",
  authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler,
  getCollaborationRequestOutbox as unknown as RequestHandler
);
router.post(
  "/requests/:id/approve",
  authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler,
  approveCollaborationRequest as unknown as RequestHandler
);
router.post(
  "/requests/:id/reject",
  authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler,
  rejectCollaborationRequest as unknown as RequestHandler
);
router.get(
  "/links",
  authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler,
  listWorkspaceCollaborations as unknown as RequestHandler
);
router.post(
  "/links/:id/revoke",
  authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler,
  revokeCollaborationLink as unknown as RequestHandler
);
router.post(
  "/links/:id/shared-channels",
  authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler,
  createSharedChannel as unknown as RequestHandler
);
router.post(
  "/links/:id/external-dm",
  authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler,
  createExternalDirectMessage as unknown as RequestHandler
);

export default router;
