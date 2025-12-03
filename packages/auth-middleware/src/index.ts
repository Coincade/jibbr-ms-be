import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWTPayload } from '@jibbr/shared-types';

export interface AuthRequest extends Request {
  user?: JWTPayload;
}

export const authMiddleware = (jwtSecret: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : header;

      if (!token) {
        return res.status(401).json({ 
          status: 401,
          message: 'Unauthorized' 
        });
      }

      if (!jwtSecret) {
        throw new Error('JWT_SECRET is not configured');
      }

      const decoded = jwt.verify(token, jwtSecret) as JWTPayload;
      req.user = decoded;
      next();
    } catch (error) {
      return res.status(401).json({ 
        status: 401,
        message: 'Unauthorized' 
      });
    }
  };
};

