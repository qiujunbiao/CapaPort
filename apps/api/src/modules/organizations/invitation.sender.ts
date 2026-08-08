import { Inject, Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import type { AppConfig } from '../../config/config.js';
import { APP_CONFIG } from '../../config/config.js';
import { SMS_PROVIDER, type SmsProvider } from '../../platform/notifications/sms.provider.js';
import type { InvitationDelivery, OrganizationInvitationSender } from './organization.service.js';

@Injectable()
export class MailpitOrganizationInvitationSender implements OrganizationInvitationSender {
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

  async send(invitation: InvitationDelivery): Promise<void> {
    const link = `agentdoor://invitations/accept?token=${encodeURIComponent(invitation.token)}`;
    if (invitation.kind === 'phone') {
      await this.sms.send({
        to: invitation.target,
        template: 'organization_invitation',
        variables: { organizationName: invitation.organizationName, link },
        idempotencyKey: invitation.invitationId,
      });
      return;
    }
    await this.transport.sendMail({
      from: this.config.notification.smtpFrom,
      to: invitation.target,
      subject: `Join ${invitation.organizationName} on Agentdoor`,
      text: `You were invited to ${invitation.organizationName}. Open this link to accept: ${link}\n\nThis invitation expires in 7 days.`,
    });
  }
}
