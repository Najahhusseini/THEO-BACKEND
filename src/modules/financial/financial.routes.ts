import { Hono } from 'hono'
import { FinancialService } from './financial.service'
import { authMiddleware, requireRole } from '../../middleware/auth'

const financialRouter = new Hono()
financialRouter.use('*', authMiddleware)

financialRouter.get('/financial-events', requireRole(['super-admin', 'admin']), async (c) => {
  const tenantId = c.get('tenantId')
  const { status, limit, offset } = c.req.query()
  const service = new FinancialService()
  const result = await service.getAllEvents(tenantId, {
    status: status as any,
    limit: limit ? Number(limit) : 50,
    offset: offset ? Number(offset) : 0,
  })
  return c.json(result)
})

financialRouter.post('/financial-events/:id/retry', requireRole(['super-admin', 'admin']), async (c) => {
  const tenantId = c.get('tenantId')
  const { id } = c.req.param()
  const service = new FinancialService()
  await service.retryEvent(id, tenantId)
  return c.json({ message: 'Event retry initiated' })
})

export default financialRouter