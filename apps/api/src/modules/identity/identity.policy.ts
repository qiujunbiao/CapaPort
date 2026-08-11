import { type IdentityKind, PASSWORD_MAX_CODE_POINTS, PASSWORD_MIN_CODE_POINTS } from '@capaport/contracts/auth';
import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import { adjacencyGraphs, dictionary } from '@zxcvbn-ts/language-common';
import { AppError } from '../../platform/errors/app-error.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const e164Pattern = /^\+[1-9]\d{7,14}$/;
const mainlandMobilePattern = /^1[3-9]\d{9}$/;
const passwordStrength = new ZxcvbnFactory({ dictionary, graphs: adjacencyGraphs });

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

  const compact = value.replace(/[\s()-]/g, '');
  const normalized = mainlandMobilePattern.test(compact) ? `+86${compact}` : compact;
  if (!e164Pattern.test(normalized)) {
    throw new AppError('AUTH_PHONE_INVALID', 'Phone numbers must use E.164 format.', 400, {
      target: ['Use a country code, for example +8613800138000.'],
    });
  }
  return normalized;
}

export function validatePasswordStrength(
  password: string,
  context: { identity?: string; displayName?: string } = {},
): void {
  const length = Array.from(password).length;
  if (length < PASSWORD_MIN_CODE_POINTS) {
    throw new AppError('AUTH_PASSWORD_TOO_SHORT', '密码至少需要 8 个字符。', 400, {
      password: ['密码至少需要 8 个字符。'],
    });
  }
  if (length > PASSWORD_MAX_CODE_POINTS) {
    throw new AppError('AUTH_PASSWORD_TOO_LONG', '密码不能超过 256 个字符。', 400, {
      password: ['密码不能超过 256 个字符。'],
    });
  }

  const identityParts = context.identity?.split(/[^\p{L}\p{N}]+/u) ?? [];
  const userInputs = [...identityParts, context.displayName, 'CapaPort'].filter((value): value is string =>
    Boolean(value?.trim()),
  );
  if (passwordStrength.check(password, userInputs).score < 2) {
    throw new AppError('AUTH_PASSWORD_TOO_SIMPLE', '该密码过于简单或容易被猜到，请换一个密码。', 400, {
      password: ['该密码过于简单或容易被猜到，请换一个密码。'],
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
