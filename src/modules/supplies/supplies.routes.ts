import { Hono } from 'hono'
import { 
    getSupplyItems, 
    getSupplyItem, 
    createSupplyItem, 
    adjustStock, 
    getTransactionHistory,
    getLowStockItems
} from './supplies.service'

const supplies = new Hono()

// Get all supply items
supplies.get('/', async (c) => {
    const user = c.get('user')
    const category = c.req.query('category')
    const items = await getSupplyItems(user.tenantId, category)
    return c.json(items)
})

// Get low stock items
supplies.get('/low-stock', async (c) => {
    const user = c.get('user')
    const items = await getLowStockItems(user.tenantId)
    return c.json(items)
})

// Create new supply item
supplies.post('/', async (c) => {
    const user = c.get('user')
    const { categoryId, name, itemsPerBox, initialBoxes, minThresholdItems } = await c.req.json()
    const item = await createSupplyItem(
        user.tenantId,
        categoryId,
        name,
        itemsPerBox,
        initialBoxes,
        minThresholdItems
    )
    return c.json(item)
})

// Adjust stock
supplies.post('/:itemId/adjust', async (c) => {
    const user = c.get('user')
    const { itemId } = c.req.param()
    const { quantityBoxes, reason, referenceType, referenceId } = await c.req.json()
    const item = await adjustStock(itemId, user.staffId, quantityBoxes, reason, referenceType, referenceId)
    return c.json(item)
})

// Get transaction history for an item
supplies.get('/:itemId/history', async (c) => {
    const { itemId } = c.req.param()
    const limit = parseInt(c.req.query('limit') || '50')
    const history = await getTransactionHistory(itemId, limit)
    return c.json(history)
})

export default supplies