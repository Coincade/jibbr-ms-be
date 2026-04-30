import { vi } from 'vitest';

export type TestReq = {
  body: Record<string, unknown>;
  params: Record<string, unknown>;
  query: Record<string, unknown>;
  headers: Record<string, unknown>;
  user?: unknown;
};

export type TestRes = {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  redirect: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
};

export function createReq(overrides: Partial<TestReq> = {}): TestReq {
  return {
    body: {},
    params: {},
    query: {},
    headers: {},
    user: undefined,
    ...overrides,
  };
}

export function createRes(): TestRes {
  const res = {} as TestRes;
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.send = vi.fn(() => res);
  res.redirect = vi.fn(() => res);
  res.render = vi.fn(() => res);
  return res;
}
