import type { ScanSeverity } from './types.js';

export type SecretRule = {
  id: string;
  severity: ScanSeverity;
  pattern: RegExp;
  message: string;
};

export const secretRules: readonly SecretRule[] = [
  {
    id: 'SEC_PRIVATE_KEY',
    severity: 'critical',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    message: 'Private key material is not allowed in a capability package.',
  },
  {
    id: 'SEC_AWS_ACCESS_KEY',
    severity: 'critical',
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
    message: 'A cloud access key was detected.',
  },
  {
    id: 'SEC_CONNECTION_STRING',
    severity: 'high',
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s/:]+:[^\s/@]+@[^\s]+/i,
    message: 'A connection string containing credentials was detected.',
  },
  {
    id: 'SEC_BEARER_TOKEN',
    severity: 'high',
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}\b/i,
    message: 'A bearer token was detected.',
  },
];
