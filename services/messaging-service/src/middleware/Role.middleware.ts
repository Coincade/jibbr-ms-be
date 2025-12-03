import { Request, Response, NextFunction } from "express";
import prisma from "../config/database.js";

const roleMiddleware = (allowedRoles: string[]) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = req.user;
            if (!user) {
                return res.status(401).json({ status: 401, message: "Unauthorized" });
            }

            const workspaceId = req.params.id;
            if (!workspaceId) {
                return res.status(400).json({ status: 400, message: "Workspace ID is required" });
            }

            const member = await prisma.member.findFirst({
                where: {
                    userId: user.id,
                    workspaceId: workspaceId,
                    isActive: true
                }
            });

            if (!member) {
                return res.status(403).json({ status: 403, message: "You are not a member of this workspace" });
            }

            if (!allowedRoles.includes(member.role)) {
                return res.status(403).json({ 
                    status: 403, 
                    message: `Access denied. Required roles: ${allowedRoles.join(', ')}` 
                });
            }

            next();
        } catch (error) {
            return res.status(500).json({ status: 500, message: "Internal server error" });
        }
    };
};

export default roleMiddleware; 