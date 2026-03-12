import { Request, Response } from 'express';
import { performSearch, type SearchParams } from '../services/search.service.js';

export const search = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const q = (req.query.q as string) ?? '';
    const from = req.query.from as string | undefined;
    const inChannel = req.query.in as string | undefined;
    const has = req.query.has as string | undefined;
    const before = req.query.before as string | undefined;
    const after = req.query.after as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

    const params: SearchParams = {
      q,
      from,
      in: inChannel,
      has,
      before,
      after,
      limit,
      offset,
    };

    const results = await performSearch(user.id, params);
    return res.json(results);
  } catch (error) {
    console.error('[search] Error:', error);
    return res.status(500).json({
      message: 'Search failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
