import { db } from '../../db';
import { webhookConfigurations, financialEvents } from '../../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import axios, { AxiosError } from 'axios';
import crypto from 'crypto';

export class WebhookService {
  async getConfig(tenantId: string) {
    const config = await db.select().from(webhookConfigurations)
      .where(and(eq(webhookConfigurations.tenantId, tenantId), eq(webhookConfigurations.enabled, true)))
      .limit(1);
    return config[0] || null;
  }

  async upsertConfig(tenantId: string, data: Partial<typeof webhookConfigurations.$inferInsert>) {
    const existing = await db.select().from(webhookConfigurations).where(eq(webhookConfigurations.tenantId, tenantId)).limit(1);
    if (existing[0]) {
      await db.update(webhookConfigurations).set({ ...data, updatedAt: new Date() }).where(eq(webhookConfigurations.id, existing[0].id));
    } else {
      await db.insert(webhookConfigurations).values({ tenantId, ...data });
    }
    return this.getConfig(tenantId);
  }

  async sendWebhook(tenantId: string, event: any) {
    const config = await this.getConfig(tenantId);
    if (!config) return { sent: false, reason: 'No webhook configured' };

    const payload = {
      event_id: event.id,
      event_type: event.eventType,
      timestamp: event.createdAt,
      data: event.payload,
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.secret) {
      const signature = crypto.createHmac('sha256', config.secret).update(JSON.stringify(payload)).digest('hex');
      headers['X-Webhook-Signature'] = signature;
    }

    try {
      const response = await axios.post(config.url, payload, {
        timeout: (config.timeoutSeconds || 10) * 1000,
        headers,
      });
      if (response.status >= 200 && response.status < 300) {
        return { sent: true, response: response.data };
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      const axiosError = error as AxiosError;
      return { sent: false, error: axiosError.message };
    }
  }

  async processPendingEvents(tenantId: string, limit = 10) {
    const config = await this.getConfig(tenantId);
    if (!config) return { processed: 0, message: 'No webhook configured' };

    const events = await db.select().from(financialEvents)
      .where(and(
        eq(financialEvents.tenantId, tenantId),
        eq(financialEvents.status, 'pending'),
        sql`${financialEvents.nextRetryAt} <= NOW()`
      ))
      .orderBy(sql`${financialEvents.nextRetryAt} ASC`)
      .limit(limit);

    let processed = 0;
    for (const event of events) {
      const result = await this.sendWebhook(tenantId, event);
      if (result.sent) {
        await db.update(financialEvents)
          .set({ status: 'delivered', updatedAt: new Date() })
          .where(eq(financialEvents.id, event.id));
        processed++;
      } else {
        const newRetryCount = (event.retryCount || 0) + 1;
        const maxRetries = config.retryCount || 5;
        if (newRetryCount >= maxRetries) {
          await db.update(financialEvents)
            .set({
              status: 'failed',
              errorMessage: result.error || 'Max retries exceeded',
              updatedAt: new Date(),
              retryCount: newRetryCount,
            })
            .where(eq(financialEvents.id, event.id));
        } else {
          const baseDelay = config.retryDelaySeconds || 60;
          const factor = 3;
          const delaySeconds = baseDelay * Math.pow(factor, newRetryCount - 1);
          const nextRetryAt = new Date(Date.now() + delaySeconds * 1000);
          await db.update(financialEvents)
            .set({
              retryCount: newRetryCount,
              nextRetryAt,
              updatedAt: new Date(),
            })
            .where(eq(financialEvents.id, event.id));
        }
        processed++;
      }
    }
    return { processed };
  }
}