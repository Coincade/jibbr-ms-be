import { beforeEach, describe, expect, it, vi } from 'vitest';

const performSearch = vi.hoisted(() => vi.fn());

vi.mock('../src/services/search.service.js', () => ({
  performSearch,
}));

import { search } from '../src/controllers/search.controller.js';

function createRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('search.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when req.user is missing', async () => {
    const req: any = { user: undefined, query: {} };
    const res = createRes();

    await search(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Unauthorized' });
    expect(performSearch).not.toHaveBeenCalled();
  });

  it('passes parsed query params to performSearch', async () => {
    performSearch.mockResolvedValue({ messages: [], channels: [], users: [], files: [], total: 0, query: 'hi', took: 1 });
    const req: any = {
      user: { id: 'u1' },
      query: {
        q: 'hi',
        from: 'u2',
        in: 'ch1',
        has: 'link',
        before: '2024-01-01',
        after: '2023-01-01',
        limit: '10',
        offset: '5',
      },
    };
    const res = createRes();

    await search(req, res);

    expect(performSearch).toHaveBeenCalledWith('u1', {
      q: 'hi',
      from: 'u2',
      in: 'ch1',
      has: 'link',
      before: '2024-01-01',
      after: '2023-01-01',
      limit: 10,
      offset: 5,
    });
    expect(res.json).toHaveBeenCalled();
  });

  it('returns 500 when performSearch throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    performSearch.mockRejectedValue(new Error('boom'));
    const req: any = { user: { id: 'u1' }, query: { q: 'x' } };
    const res = createRes();

    await search(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Search failed',
      error: 'boom',
    });
  });
});
