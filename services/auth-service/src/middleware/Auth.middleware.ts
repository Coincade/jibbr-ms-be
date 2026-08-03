import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import prisma from "../config/database.js";

const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({status: 401, message: "Unauthorized"});
    }
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).json({status: 401, message: "Unauthorized"});
    }

    try {
        const user = jwt.verify(token, process.env.JWT_SECRET as string) as AuthUser & { tv?: number };
        const claimedTv = typeof user.tv === "number" ? user.tv : 0;
        const dbUser = await prisma.user.findUnique({
            where: { id: user.id },
            select: { tokenVersion: true },
        });
        if (!dbUser || (dbUser.tokenVersion ?? 0) !== claimedTv) {
            return res.status(401).json({status: 401, message: "Unauthorized"});
        }
        req.user = user;
        next();
    } catch {
        return res.status(401).json({status: 401, message: "Unauthorized"});
    }
}

export default authMiddleware;
