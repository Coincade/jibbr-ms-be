import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const verify = vi.hoisted(() => vi.fn());

vi.mock('jsonwebtoken', () => ({
  default: { verify },
}));

import { authMiddleware, setTokenVersionLookup } from '../src/index';

function createRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as Response & { statusCode: number; body: unknown };
}

afterEach(() => {
  setTokenVersionLookup(null);
});

describe('authMiddleware', () => {
  beforeEach(() => {
    verify.mockReset();
    setTokenVersionLookup(null);
  });

  it('returns 401 when the request has no token', async () => {
    const req = { headers: {} } as Request;
    const res = createRes();
    const next = vi.fn();

    await authMiddleware('secret')(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ status: 401, message: 'Unauthorized' });
    expect(next).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it('returns 401 when the token cannot be verified', async () => {
    verify.mockImplementation(() => {
      throw new Error('bad token');
    });
    const req = { headers: { authorization: 'Bearer nope' } } as Request;
    const res = createRes();
    const next = vi.fn();

    await authMiddleware('secret')(req, res, next);

    expect(verify).toHaveBeenCalledWith('nope', 'secret');
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the jwt secret is empty', async () => {
    const req = { headers: { authorization: 'Bearer token' } } as Request;
    const res = createRes();
    const next = vi.fn();

    await authMiddleware('')(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it('sets req.user and continues when the token is valid', async () => {
    const payload = { id: 'user-1', email: 'a@b.c' };
    verify.mockReturnValue(payload);
    const req = { headers: { authorization: 'Bearer good' } } as Request & { user?: unknown };
    const res = createRes();
    const next = vi.fn();

    await authMiddleware('secret')(req, res, next);

    expect(req.user).toEqual(payload);
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 401 when the token version does not match the current version', async () => {
    verify.mockReturnValue({ id: 'user-1', tv: 1 });
    setTokenVersionLookup(async () => 2);
    const req = { headers: { authorization: 'token-only' } } as Request;
    const res = createRes();
    const next = vi.fn();

    await authMiddleware('secret')(req, res, next);

    expect(verify).toHaveBeenCalledWith('token-only', 'secret');
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('continues when the token version matches', async () => {
    verify.mockReturnValue({ id: 'user-1', tv: 4 });
    setTokenVersionLookup(async () => 4);
    const req = { headers: { authorization: 'Bearer good' } } as Request & { user?: unknown };
    const res = createRes();
    const next = vi.fn();

    await authMiddleware('secret')(req, res, next);

    expect(req.user).toEqual({ id: 'user-1', tv: 4 });
    expect(next).toHaveBeenCalledOnce();
  });

  it('treats a missing tv claim as version 0', async () => {
    verify.mockReturnValue({ id: 'user-1' });
    setTokenVersionLookup(async () => 0);
    const req = { headers: { authorization: 'Bearer good' } } as Request;
    const res = createRes();
    const next = vi.fn();

    await authMiddleware('secret')(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
