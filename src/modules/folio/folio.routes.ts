import { Hono } from 'hono'
import { getFolioByStayId, getFolioItems, addFolioItem } from './folio.service'

const folioRoutes = new Hono()

// GET /api/folio/stay/:stayId – return folio with items
folioRoutes.get('/stay/:stayId', async (c) => {
  const { stayId } = c.req.param()
  try {
    const folio = await getFolioByStayId(stayId)
    if (!folio) return c.json({ error: 'Folio not found' }, 404)
    const items = await getFolioItems(folio.id)
    return c.json({ ...folio, items })
  } catch (err: any) {
    console.error('Get folio error:', err)
    return c.json({ error: err.message }, 500)
  }
})

// POST /api/folio/stay/:stayId/charge – add a manual charge
folioRoutes.post('/stay/:stayId/charge', async (c) => {
  const { stayId } = c.req.param()
  const { description, amount, chargeType, quantity, unitPrice } = await c.req.json()

  if (!description || !amount) {
    return c.json({ error: 'Description and amount required' }, 400)
  }

  try {
    const folio = await getFolioByStayId(stayId)
    if (!folio) return c.json({ error: 'Folio not found' }, 404)

    await addFolioItem(
      folio.id,
      description,
      parseFloat(amount),
      chargeType || 'other',
      quantity || 1,
      unitPrice || null
    )
    return c.json({ success: true })
  } catch (err: any) {
    console.error('Add charge error:', err)
    return c.json({ error: err.message }, 500)
  }
})

export default folioRoutes