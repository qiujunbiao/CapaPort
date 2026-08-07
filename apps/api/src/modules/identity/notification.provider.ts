import type { IdentityKind } from '@agentdoor/contracts/auth';
import { Inject, Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import type { AppConfig } from '../../config/config.js';
import { APP_CONFIG } from '../../config/config.js';
import type { PreparedChallenge, VerificationSender } from './verification.service.js';

@Injectable()
export class MailpitVerificationSender implements VerificationSender {
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.transport = nodemailer.createTransport({
      host: config.notification.smtpHost,
      port: config.notification.smtpPort,
      secure: false,
    });
  }

  async send(challenge: PreparedChallenge): Promise<void> {
    const destination = this.destination(challenge.kind, challenge.target);
    const action =
      challenge.purpose === 'verify_identity' ? 'verify your Agentdoor account' : 'reset your Agentdoor password';
    await this.transport.sendMail({
      from: this.config.notification.smtpFrom,
      to: destination,
      subject: `Agentdoor security code: ${challenge.code}`,
      text: `Use ${challenge.code} to ${action}. It expires in ${this.config.auth.verificationTtlMinutes} minutes. If you did not request this, ignore this message.`,
    });
  }

  private destination(kind: IdentityKind, target: string): string {
    if (kind === 'email') return target;
    const digits = target.replace(/\D/g, '');
    return `sms.${digits}@agentdoor.local`;
  }
}
