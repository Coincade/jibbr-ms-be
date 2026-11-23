import { describe, expect, it } from 'vitest';
import {
  createWorkspaceSchema,
  joinWorkspaceByCodeSchema,
  joinWorkspaceSchema,
} from '../src/validation/workspace.validations.js';

describe('workspace validations', () => {
  it('requires a workspace name of at least 3 characters', () => {
    expect(createWorkspaceSchema.safeParse({ name: 'Ace' }).success).toBe(true);
    const tooShort = createWorkspaceSchema.safeParse({ name: 'Ab' });
    expect(tooShort.success).toBe(false);
    if (!tooShort.success) {
      expect(tooShort.error.issues[0]?.path).toEqual(['name']);
    }
  });

  it('requires a 6 digit join code', () => {
    expect(joinWorkspaceSchema.safeParse({ joinCode: '123456' }).success).toBe(true);
    expect(joinWorkspaceSchema.safeParse({ joinCode: '12345' }).success).toBe(false);
    expect(joinWorkspaceSchema.safeParse({ joinCode: '12345a' }).success).toBe(false);
  });

  it('uses the same join code rule when joining by code', () => {
    expect(joinWorkspaceByCodeSchema.safeParse({ joinCode: '000111' }).success).toBe(true);
    expect(joinWorkspaceByCodeSchema.safeParse({ joinCode: '' }).success).toBe(false);
  });
});
