import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWTPayload } from '@jibbr/shared-types';

export interface AuthRequest extends Request {
  user?: JWTPayload;
}

type TokenVersionLookup = (userId: string) => Promise<number | null>;

let tokenVersionLookup: TokenVersionLookup | null = null;

/**
 * Optional hook so services can enforce tokenVersion revocation
 * without forcing @jibbr/database into this package.
 */
export const setTokenVersionLookup = (lookup: TokenVersionLookup | null) => {
  tokenVersionLookup = lookup;
};

export const authMiddleware = (jwtSecret: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
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
      if (tokenVersionLookup) {
        const claimedTv = typeof decoded.tv === 'number' ? decoded.tv : 0;
        const currentTv = await tokenVersionLookup(decoded.id);
        if (currentTv === null || currentTv !== claimedTv) {
          return res.status(401).json({
            status: 401,
            message: 'Unauthorized',
          });
        }
      }
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
