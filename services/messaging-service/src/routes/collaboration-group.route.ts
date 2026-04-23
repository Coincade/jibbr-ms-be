import express, { RequestHandler } from "express";
import { authMiddleware } from "@jibbr/auth-middleware";
import {
  acceptGroupInvite,
  createGroup,
  createGroupSharedChannel,
  getGroup,
  inviteWorkspace,
  listGroups,
  rejectGroupInvite,
  revokeGroupMembership,
} from "../controllers/collaboration-group.controller.js";

const router = express.Router();
const auth = authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler;

router.post("/", auth, createGroup as unknown as RequestHandler);
router.get("/", auth, listGroups as unknown as RequestHandler);
router.get("/:id", auth, getGroup as unknown as RequestHandler);
router.post("/:id/invite", auth, inviteWorkspace as unknown as RequestHandler);
router.post("/:id/accept", auth, acceptGroupInvite as unknown as RequestHandler);
router.post("/:id/reject", auth, rejectGroupInvite as unknown as RequestHandler);
router.post("/:id/memberships/:workspaceId/revoke", auth, revokeGroupMembership as unknown as RequestHandler);
router.post("/:id/shared-channels", auth, createGroupSharedChannel as unknown as RequestHandler);

export default router;
