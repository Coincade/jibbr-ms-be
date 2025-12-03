import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader === null || authHeader === undefined) {
        return res.status(401).json({status: 401,message: "Unauthorized"});
    }
    const token = authHeader.split(" ")[1];

    //verify token
    jwt.verify(token, process.env.JWT_SECRET as string, (err, user) => {
        if(err) return res.status(401).json({status: 401,message: "Unauthorized"});
        req.user = user as AuthUser;
        next()
    })
}

export default authMiddleware;

