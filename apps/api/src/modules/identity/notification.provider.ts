import { Inject, Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import type { AppConfig } from '../../config/config.js';
import { APP_CONFIG } from '../../config/config.js';
import { SMS_PROVIDER, type SmsProvider } from '../../platform/notifications/sms.provider.js';
import type { PreparedChallenge, VerificationSender } from './verification.service.js';

@Injectable()
export class MailpitVerificationSender implements VerificationSender {
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {
    this.transport = nodemailer.createTransport({
      host: config.notification.smtpHost,
      port: config.notification.smtpPort,
      secure: false,
    });
  }

  async send(challenge: PreparedChallenge): Promise<void> {
    if (challenge.kind === 'phone') {
      await this.sms.send({
        to: challenge.target,
        template: challenge.purpose === 'verify_identity' ? 'identity_verification' : 'password_recovery',
        variables: {
          code: challenge.code,
          expiresInMinutes: String(this.config.auth.verificationTtlMinutes),
        },
        idempotencyKey: challenge.id,
      });
      return;
    }
    const action =
      challenge.purpose === 'verify_identity' ? 'verify your CapaPort account' : 'reset your CapaPort password';
    await this.transport.sendMail({
      from: this.config.notification.smtpFrom,
      to: challenge.target,
      subject: `CapaPort security code: ${challenge.code}`,
      text: `Use ${challenge.code} to ${action}. It expires in ${this.config.auth.verificationTtlMinutes} minutes. If you did not request this, ignore this message.`,
    });
  }
}
