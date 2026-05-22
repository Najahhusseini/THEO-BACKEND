import { Hono } from 'hono';
import { WebhookService } from './webhook.service';
import { authMiddleware, requireRole } from '../../middleware/auth';

const webhookRouter = new Hono();
webhookRouter.use('*', authMiddleware);

// GET /api/admin/webhook – get current config
webhookRouter.get('/admin/webhook', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('tenantId');
  const service = new WebhookService();
  const config = await service.getConfig(tenantId);
  return c.json(config || {});
});

// POST /api/admin/webhook – update config
webhookRouter.post('/admin/webhook', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('tenantId');
  const body = await c.req.json();
  const service = new WebhookService();
  const config = await service.upsertConfig(tenantId, body);
  return c.json(config);
});

// POST /api/admin/webhook/test – send test event
webhookRouter.post('/admin/webhook/test', requireRole(['admin', 'manager']), async (c) => {
  const tenantId = c.get('tenantId');
  const service = new WebhookService();
  const testEvent = {
    id: 'test-' + Date.now(),
    event_type: 'test.webhook',
    createdAt: new Date().toISOString(),
    payload: { message: 'This is a test webhook from THEO' },
  };
  const result = await service.sendWebhook(tenantId, testEvent);
  return c.json(result);
});

export default webhookRouter;