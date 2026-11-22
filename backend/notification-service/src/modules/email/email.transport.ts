import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../../common/utils/logger.js';

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailTransport {
  sendMail(options: SendMailOptions): Promise<{ messageId: string }>;
}

export class NodemailerTransport implements EmailTransport {
  private transporter: Transporter;

  constructor(customTransporter?: Transporter) {
    if (customTransporter) {
      this.transporter = customTransporter;
    } else {
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth:
          env.SMTP_USER && env.SMTP_PASS
            ? {
                user: env.SMTP_USER,
                pass: env.SMTP_PASS,
              }
            : undefined,
      });
    }
  }

  async sendMail(options: SendMailOptions): Promise<{ messageId: string }> {
    logger.info('Dispatching email', {
      to: options.to,
      subject: options.subject,
    });

    const info = await this.transporter.sendMail({
      from: env.SMTP_FROM,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });

    return { messageId: info.messageId };
  }
}

let defaultTransport: EmailTransport | null = null;

export function getEmailTransport(): EmailTransport {
  if (!defaultTransport) {
    defaultTransport = new NodemailerTransport();
  }
  return defaultTransport;
}

export function setEmailTransport(transport: EmailTransport | null): void {
  defaultTransport = transport;
}
