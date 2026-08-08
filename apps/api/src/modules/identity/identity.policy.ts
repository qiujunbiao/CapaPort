import type { IdentityKind } from '@capaport/contracts/auth';
import { AppError } from '../../platform/errors/app-error.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const e164Pattern = /^\+[1-9]\d{7,14}$/;

export function normalizeIdentity(kind: IdentityKind, input: string): string {
  const value = input.trim();
  if (kind === 'email') {
    const normalized = value.toLowerCase();
    if (!emailPattern.test(normalized)) {
      throw new AppError('AUTH_EMAIL_INVALID', 'Enter a valid email address.', 400, {
        target: ['Invalid email address.'],
      });
    }
    return normalized;
  }

  const normalized = value.replace(/[\s()-]/g, '');
  if (!e164Pattern.test(normalized)) {
    throw new AppError('AUTH_PHONE_INVALID', 'Phone numbers must use E.164 format.', 400, {
      target: ['Use a country code, for example +8613800138000.'],
    });
  }
  return normalized;
}

export function validatePasswordStrength(password: string): void {
  const failures: string[] = [];
  if (password.length < 12) failures.push('Use at least 12 characters.');
  if (!/[a-z]/.test(password)) failures.push('Add a lowercase letter.');
  if (!/[A-Z]/.test(password)) failures.push('Add an uppercase letter.');
  if (!/\d/.test(password)) failures.push('Add a number.');
  if (!/[^A-Za-z0-9]/.test(password)) failures.push('Add a symbol.');
  if (/password|123456|qwerty|letmein|admin/i.test(password)) failures.push('Avoid common password phrases.');
  if (failures.length > 0) {
    throw new AppError('AUTH_PASSWORD_WEAK', 'Password does not meet the security policy.', 400, {
      password: failures,
    });
  }
}

export function maskIdentity(kind: IdentityKind, value: string): string {
  if (kind === 'email') {
    const [local = '', domain = ''] = value.split('@');
    return `${local.slice(0, 2)}***@${domain}`;
  }
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}
