import { Inject, Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import type { AppConfig } from '../../config/config.js';
import { APP_CONFIG } from '../../config/config.js';
import type { InvitationDelivery, OrganizationInvitationSender } from './organization.service.js';

@Injectable()
export class MailpitOrganizationInvitationSender implements OrganizationInvitationSender {
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.transport = nodemailer.createTransport({
      host: config.notification.smtpHost,
      port: config.notification.smtpPort,
      secure: false,
    });
  }

  async send(invitation: InvitationDelivery): Promise<void> {
    const destination =
      invitation.kind === 'email' ? invitation.target : `sms.${invitation.target.replace(/\D/g, '')}@agentdoor.local`;
    const link = `agentdoor://invitations/accept?token=${encodeURIComponent(invitation.token)}`;
    await this.transport.sendMail({
      from: this.config.notification.smtpFrom,
      to: destination,
      subject: `Join ${invitation.organizationName} on Agentdoor`,
      text: `You were invited to ${invitation.organizationName}. Open this link to accept: ${link}\n\nThis invitation expires in 7 days.`,
    });
  }
}
