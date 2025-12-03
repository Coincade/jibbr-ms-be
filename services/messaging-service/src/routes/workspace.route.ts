import express, { RequestHandler } from "express";
import { createWorkspace, getAllWorkspaces, getWorkspace, getAllWorkspacesForUser, getWorkspaceMembers, joinWorkspace, leaveWorkspace, updateWorkspace, softDeleteWorkspace, hardDeleteWorkspace, getPublicChannels, updateMemberRole } from "../controllers/workspace.controller.js";
import { authMiddleware } from "@jibbr/auth-middleware";
import roleMiddleware from "../middleware/Role.middleware.js";

const router = express.Router();

router.post("/create", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, createWorkspace as unknown as RequestHandler);
router.post("/join/:id", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, joinWorkspace as unknown as RequestHandler);
router.post("/leave/:id", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, leaveWorkspace as unknown as RequestHandler);

router.get("/all", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, getAllWorkspaces as unknown as RequestHandler);
router.get("/get-workspaces-for-user", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, getAllWorkspacesForUser as unknown as RequestHandler);
router.get("/get-workspace-members/:id", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, getWorkspaceMembers as unknown as RequestHandler);
router.get("/get-public-channels/:id", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, getPublicChannels as unknown as RequestHandler);
router.get("/:id", authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, getWorkspace as unknown as RequestHandler);

// Update member role (admin only)
router.put("/:id/members/:memberId/role", 
    authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, 
    roleMiddleware(["ADMIN"]) as unknown as RequestHandler, 
    updateMemberRole as unknown as RequestHandler
);

router.put("/:id", 
    authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, 
    roleMiddleware(["ADMIN"]) as unknown as RequestHandler, 
    updateWorkspace as unknown as RequestHandler
);

// Soft delete a workspace (preserves all data)
router.delete("/:id/soft", 
    authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, 
    roleMiddleware(["ADMIN"]) as unknown as RequestHandler, 
    softDeleteWorkspace as unknown as RequestHandler
);

// Hard delete a workspace (permanently removes everything - requires DELETE_PASS)
router.delete("/:id/hard", 
    authMiddleware(process.env.JWT_SECRET!) as unknown as RequestHandler, 
    hardDeleteWorkspace as unknown as RequestHandler
);

export default router;