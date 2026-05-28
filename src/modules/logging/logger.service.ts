import { db } from '../../db';
import { sql } from 'drizzle-orm';
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export interface LogEntry {
  tenantId: string;
  severity: 'info' | 'warn' | 'error' | 'critical';
  module: string;
  message: string;
  details?: any;
  stack?: string;
}

export async function log(entry: LogEntry) {
  // 1. Save to database
  await db.execute(sql`
    INSERT INTO error_logs (tenant_id, severity, module, message, details, stack)
    VALUES (${entry.tenantId}, ${entry.severity}, ${entry.module}, ${entry.message}, 
            ${entry.details ? JSON.stringify(entry.details) : null}, ${entry.stack || null})
  `);

  // 2. Console output
  const prefix = `[${entry.severity.toUpperCase()}] [${entry.module}]`;
  if (entry.severity === 'error' || entry.severity === 'critical') {
    console.error(prefix, entry.message, entry.details || '', entry.stack || '');
  } else {
    console.log(prefix, entry.message, entry.details || '');
  }

  // 3. Email alert for critical errors (immediate)
  if (entry.severity === 'critical') {
    try {
      // Fetch tenant admin email (you can store alert_email in tenants table)
      // For now, use a generic admin email from env
      const adminEmail = process.env.ALERT_EMAIL || 'admin@theo.com';
      await transporter.sendMail({
        from: `"THEO Alert" <${process.env.SMTP_USER}>`,
        to: adminEmail,
        subject: `🚨 THEO Critical Error: ${entry.module}`,
        html: `
          <h2>Critical Error</h2>
          <p><strong>Module:</strong> ${entry.module}</p>
          <p><strong>Message:</strong> ${entry.message}</p>
          <p><strong>Details:</strong> ${entry.details ? JSON.stringify(entry.details) : 'None'}</p>
          <p><strong>Stack:</strong> <pre>${entry.stack || 'No stack trace'}</pre></p>
          <p><strong>Time:</strong> ${new Date().toISOString()}</p>
        `,
      });
    } catch (emailErr) {
      console.error('Failed to send alert email:', emailErr);
    }
  }
}

// Convenience methods
export const logInfo = (tenantId: string, module: string, message: string, details?: any) =>
  log({ tenantId, severity: 'info', module, message, details });

export const logWarn = (tenantId: string, module: string, message: string, details?: any) =>
  log({ tenantId, severity: 'warn', module, message, details });

export const logError = (tenantId: string, module: string, message: string, error?: any) =>
  log({ tenantId, severity: 'error', module, message, details: error?.response?.data || error?.message, stack: error?.stack });

export const logCritical = (tenantId: string, module: string, message: string, error?: any) =>
  log({ tenantId, severity: 'critical', module, message, details: error?.response?.data || error?.message, stack: error?.stack });