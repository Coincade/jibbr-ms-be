import { describe, it, expect } from 'vitest';
import { registerSchema, passwordSchema, loginSchema, resetPasswordSchema, forgetPasswordSchema, forgetResetPasswordSchema } from '../../src/validation/auth.validations';

describe('Auth Validation Testing', () => {
  it('passwordSchema rejects short passwords', () => {
    const result = passwordSchema.safeParse('Abc123');
    expect(result.success).toBe(false);
  });

  it('passwordSchema rejects missing uppercase/lowercase/number', () => {
    expect(passwordSchema.safeParse('abcdefgh').success).toBe(false);
    expect(passwordSchema.safeParse('ABCDEFGH').success).toBe(false);
    expect(passwordSchema.safeParse('Abcdefgh').success).toBe(false);
  });

  it('passwordSchema accepts a strong password', () => {
    const result = passwordSchema.safeParse('Abcdefg1');
    expect(result.success).toBe(true);
  });

  it('registerSchema rejects password/confirmPassword mismatch', () => {
    const result = registerSchema.safeParse({
      name: 'Yash',
      email: 'yash@example.com',
      password: 'Abcdefg1',
      confirmPassword: 'Abcdefg2',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) =>
        i.path.includes('confirmPassword')
      );
      expect(issue?.message).toBe('Passwords do not match');
    }
  });

  it('loginSchema rejects invalid email', () => {
    const result = loginSchema.safeParse({
      email: 'not-an-email',
      password: 'Abcdefg1',
    });
    expect(result.success).toBe(false);
  });

  it('resetPasswordSchema rejects mismatch even if both strong', () => {
    const result = resetPasswordSchema.safeParse({
      email: 'yash@example.com',
      currentPassword: 'Abcdefg1',
      password: 'Abcdefg2',
      confirmPassword: 'Abcdefg3',
    });
    expect(result.success).toBe(false);
  });
});
