import nodemailer from 'nodemailer';
import type { AppConfig } from '../../config/config.js';

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export type SmsTemplate = 'identity_verification' | 'password_recovery' | 'organization_invitation' | 'notification';
export type SmsMessage = {
  to: string;
  template: SmsTemplate;
  variables: Record<string, string>;
  idempotencyKey: string;
};

export interface SmsProvider {
  send(message: SmsMessage): Promise<void>;
}

export class SmsDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

type SmsHttpConfig = NonNullable<AppConfig['notification']['sms']>;

function validate(message: SmsMessage): void {
  if (!/^\+[1-9]\d{7,14}$/.test(message.to)) throw new SmsDeliveryError('SMS_TARGET_INVALID', false);
  if (!message.idempotencyKey || message.idempotencyKey.length > 200)
    throw new SmsDeliveryError('SMS_IDEMPOTENCY_KEY_INVALID', false);
  if (
    Object.entries(message.variables).some(
      ([key, value]) => !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || value.length > 2_000,
    )
  )
    throw new SmsDeliveryError('SMS_VARIABLES_INVALID', false);
}

export class HttpSmsProvider implements SmsProvider {
  constructor(
    private readonly config: SmsHttpConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async send(message: SmsMessage): Promise<void> {
    validate(message);
    let response: Response;
    try {
      response = await this.fetcher(this.config.endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.config.token}`,
          'content-type': 'application/json',
          'idempotency-key': message.idempotencyKey,
        },
        body: JSON.stringify({
          sender: this.config.sender,
          to: message.to,
          template: message.template,
          variables: message.variables,
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch {
      throw new SmsDeliveryError('SMS_PROVIDER_UNAVAILABLE', true);
    }
    if (!response.ok) {
      throw new SmsDeliveryError(
        `SMS_PROVIDER_${response.status}`,
        response.status === 408 || response.status === 429 || response.status >= 500,
      );
    }
  }
}

export class DevelopmentSmsProvider implements SmsProvider {
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;

  constructor(private readonly notification: AppConfig['notification']) {
    this.transport = nodemailer.createTransport({
      host: notification.smtpHost,
      port: notification.smtpPort,
      secure: false,
    });
  }

  async send(message: SmsMessage): Promise<void> {
    validate(message);
    const digits = message.to.replace(/\D/g, '');
    await this.transport.sendMail({
      from: this.notification.smtpFrom,
      to: `sms.${digits}@capaport.local`,
      messageId: `<sms.${message.idempotencyKey}@capaport.local>`,
      subject: `CapaPort SMS: ${message.template}`,
      text: JSON.stringify(message.variables),
    });
  }
}

export function createSmsProvider(config: AppConfig): SmsProvider {
  return config.notification.sms
    ? new HttpSmsProvider(config.notification.sms)
    : new DevelopmentSmsProvider(config.notification);
}
