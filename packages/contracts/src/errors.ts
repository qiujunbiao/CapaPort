import type { ZodError } from 'zod';

export type ErrorEnvelope = {
  code: string;
  message: string;
  requestId?: string;
  fieldErrors?: Record<string, string[]>;
};

export function zodFieldErrors(error: ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_root';
    const messages = errors[key] ?? [];
    messages.push(issue.message);
    errors[key] = messages;
  }
  return errors;
}
