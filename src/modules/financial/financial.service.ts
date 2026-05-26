import { db } from '../../db';
import { financialEvents, NewFinancialEvent } from '../../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

export class FinancialService {
  async getAllEvents(
    tenantId: string,
    filters?: { status?: 'pending' | 'delivered' | 'failed'; limit?: number; offset?: number }
  ) {
    let query = db
      .select()
      .from(financialEvents)
      .where(eq(financialEvents.tenantId, tenantId));

    if (filters?.status) {
      query = query.where(eq(financialEvents.status, filters.status));
    }

    query = query.orderBy(desc(financialEvents.createdAt));

    if (filters?.limit) {
      query = query.limit(filters.limit);
    }
    if (filters?.offset) {
      query = query.offset(filters.offset);
    }

    const events = await query;
    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(financialEvents)
      .where(eq(financialEvents.tenantId, tenantId));

    return {
      events,
      total: Number(totalResult[0]?.count || 0),
    };
  }

  async retryEvent(eventId: string, tenantId: string) {
    const event = await db.query.financialEvents.findFirst({
      where: and(eq(financialEvents.id, eventId), eq(financialEvents.tenantId, tenantId)),
    });

    if (!event) throw new Error('Financial event not found');
    if (event.status !== 'failed') throw new Error('Only failed events can be retried');

    await db
      .update(financialEvents)
      .set({ status: 'pending', errorMessage: null, updatedAt: new Date() })
      .where(eq(financialEvents.id, eventId));

    return { success: true, eventId };
  }

  async createEvent(data: Omit<NewFinancialEvent, 'id' | 'createdAt' | 'updatedAt'>, tx?: any) {
    const executor = tx || db;
    const [event] = await executor.insert(financialEvents).values(data).returning();
    return event;
  }

  // ✅ FIX: use eventType instead of type
  async recordEvent(tenantId: string, eventType: string, payload: any, tx?: any) {
    let serialized: any;
    try {
      serialized = payload;
      JSON.stringify(serialized);
    } catch {
      throw new Error('Payload is not JSON‑serializable');
    }
    return this.createEvent({ tenantId, eventType, payload: serialized, status: 'pending' }, tx);
  }

  async recordEventWithTx(tenantId: string, eventType: string, payload: any, tx: any) {
    return this.recordEvent(tenantId, eventType, payload, tx);
  }

  async retryAllFailed(tenantId: string, batchSize = 10) {
    const events = await db
      .select()
      .from(financialEvents)
      .where(and(eq(financialEvents.tenantId, tenantId), eq(financialEvents.status, 'failed')))
      .limit(batchSize);

    let retried = 0;
    for (const event of events) {
      try {
        await this.retryEvent(event.id, tenantId);
        retried++;
      } catch (err) {
        console.error(`Failed to retry event ${event.id}:`, err);
      }
    }
    return { retried };
  }
}