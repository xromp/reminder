import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import { LoggerService } from '../../common/utils/logger.service';

export interface EmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

@Injectable()
export class EmailService {
  private transporter: Transporter;
  private readonly fromEmail: string;
  private readonly fromName: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    const smtpConfig = this.configService.get('smtp');
    
    this.fromEmail = smtpConfig.from.email;
    this.fromName = smtpConfig.from.name;

    // Create nodemailer transporter
    this.transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      // For MailHog, we don't need auth
      // auth: {
      //   user: smtpConfig.auth?.user,
      //   pass: smtpConfig.auth?.pass,
      // },
    });

    this.logger.log('EmailService initialized', { service: 'EmailService' });
    this.logger.log(
      `SMTP configured: ${smtpConfig.host}:${smtpConfig.port}`,
      { service: 'EmailService' },
    );
  }

  /**
   * Send an email via SMTP
   */
  async sendEmail(options: EmailOptions): Promise<boolean> {
    try {
      const mailOptions = {
        from: `"${this.fromName}" <${this.fromEmail}>`,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      };

      const info = await this.transporter.sendMail(mailOptions);

      this.logger.log(
        `Email sent successfully to ${options.to} - Message ID: ${info.messageId}`,
        { service: 'EmailService' },
      );

      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send email to ${options.to}`,
        error.stack,
        { service: 'EmailService' },
      );
      throw error;
    }
  }

  /**
   * Send a birthday reminder email
   */
  async sendBirthdayReminder(
    toEmail: string,
    birthdayPersonName: string,
    daysUntil: number,
  ): Promise<boolean> {
    const subject =
      daysUntil === 0
        ? `🎉 Today is ${birthdayPersonName}'s Birthday!`
        : `🎂 Birthday Reminder: ${birthdayPersonName}'s birthday is in ${daysUntil} day${daysUntil > 1 ? 's' : ''}`;

    const text =
      daysUntil === 0
        ? `Today is ${birthdayPersonName}'s birthday! Don't forget to wish them a happy birthday! 🎉`
        : `This is a friendly reminder that ${birthdayPersonName}'s birthday is coming up in ${daysUntil} day${daysUntil > 1 ? 's' : ''}. Don't forget to prepare!`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
            border-radius: 10px 10px 0 0;
          }
          .content {
            background: #f9f9f9;
            padding: 30px;
            border-radius: 0 0 10px 10px;
          }
          .emoji {
            font-size: 48px;
            margin-bottom: 10px;
          }
          h1 {
            margin: 0;
            font-size: 24px;
          }
          .footer {
            margin-top: 20px;
            text-align: center;
            font-size: 12px;
            color: #666;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="emoji">${daysUntil === 0 ? '🎉' : '🎂'}</div>
          <h1>${daysUntil === 0 ? 'Birthday Today!' : 'Birthday Reminder'}</h1>
        </div>
        <div class="content">
          <p>${daysUntil === 0 ? `<strong>Today is ${birthdayPersonName}'s birthday!</strong>` : `This is a friendly reminder that <strong>${birthdayPersonName}'s birthday</strong> is coming up in <strong>${daysUntil} day${daysUntil > 1 ? 's' : ''}</strong>.`}</p>
          <p>${daysUntil === 0 ? "Don't forget to wish them a happy birthday! 🎉" : "Don't forget to prepare! 🎁"}</p>
        </div>
        <div class="footer">
          <p>Sent by Reminder App</p>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to: toEmail,
      subject,
      text,
      html,
    });
  }

  /**
   * Verify SMTP connection
   */
  async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      this.logger.log('SMTP connection verified successfully', { service: 'EmailService' });
      return true;
    } catch (error) {
      this.logger.error(
        'SMTP connection verification failed',
        error.stack,
        { service: 'EmailService' },
      );
      return false;
    }
  }
}

