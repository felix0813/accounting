import { Hono } from 'hono'
import { cors } from 'hono/cors'

type D1Database = {
  prepare(query: string): D1PreparedStatement
}

type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  run(): Promise<{ meta: { changes?: number } }>
}

type KVNamespace = {
  get<T = unknown>(key: string, type: 'json'): Promise<T | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string }): Promise<{ keys: { name: string }[] }>
}

type Bindings = {
  DB: D1Database
  CACHE: KVNamespace
  ALLOWED_ORIGIN?: string
}

type ExpenseInput = {
  amount?: unknown
  category?: unknown
  note?: unknown
  spentAt?: unknown
}

type ExpenseRow = {
  id: number
  amount: number
  category: string
  note: string
  spent_at: string
  created_at: string
  updated_at: string
}

const DEFAULT_CATEGORIES = ['餐饮', '交通', '购物', '居住', '娱乐', '医疗', '学习', '其他']
const CATEGORY_CACHE_KEY = 'categories:v1'
const STATS_CACHE_PREFIX = 'stats:v1:'
const MAX_LIMIT = 200

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', async (c, next) => {
  const allowedOrigin = c.env.ALLOWED_ORIGIN || '*'
  const middleware = cors({
    origin: allowedOrigin === '*' ? '*' : allowedOrigin,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    maxAge: 86400,
  })
  return middleware(c, next)
})

app.onError((error, c) => {
  console.error('Unhandled backend error', { message: error.message, stack: error.stack })
  return c.json({ error: 'internal server error', details: error.message }, 500)
})

app.get('/health', async (c) => {
  const checks = {
    db: { ok: false, error: null as string | null },
    cache: { ok: false, error: null as string | null },
  }

  try {
    await c.env.DB.prepare('SELECT 1 as ok').first()
    checks.db.ok = true
    console.log('Health check: DB connected')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown db error'
    checks.db.error = message
    console.error('Health check: DB failed', { error: message })
  }

  try {
    const key = 'health:cache:probe'
    await c.env.CACHE.put(key, JSON.stringify({ checkedAt: Date.now() }), { expirationTtl: 60 })
    await c.env.CACHE.get(key, 'json')
    checks.cache.ok = true
    console.log('Health check: CACHE connected')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown cache error'
    checks.cache.error = message
    console.error('Health check: CACHE failed', { error: message })
  }

  const ok = checks.db.ok && checks.cache.ok
  const status = ok ? 200 : 503
  if (!ok) {
    console.error('Health check failed', checks)
  }
  return c.json({ ok, service: 'accounting-backend', checks }, status)
})

app.get('/api/categories', async (c) => {
  const cached = await c.env.CACHE.get<string[]>(CATEGORY_CACHE_KEY, 'json')
  if (cached) {
    console.log('Loaded categories from KV cache', { count: cached.length })
    return c.json({ categories: cached })
  }

  console.log('Categories cache miss, writing default categories')
  await c.env.CACHE.put(CATEGORY_CACHE_KEY, JSON.stringify(DEFAULT_CATEGORIES))
  return c.json({ categories: DEFAULT_CATEGORIES })
})

app.put('/api/categories', async (c) => {
  const body = await c.req.json<{ categories?: unknown }>()
  if (!Array.isArray(body.categories)) {
    console.error('Invalid categories payload', { payloadType: typeof body.categories })
    return c.json({ error: 'categories must be an array', details: 'payload.categories is not an array' }, 400)
  }

  const categories = body.categories
    .map((item) => String(item).trim())
    .filter((item, index, list) => item.length > 0 && list.indexOf(item) === index)

  if (categories.length === 0) {
    console.error('Rejected empty categories update')
    return c.json({ error: 'at least one category is required', details: 'categories became empty after trimming and deduplication' }, 400)
  }

  await c.env.CACHE.put(CATEGORY_CACHE_KEY, JSON.stringify(categories))
  console.log('Updated categories in KV', { count: categories.length })
  return c.json({ categories })
})

app.get('/api/expenses', async (c) => {
  const { from, to, category, q } = c.req.query()
  const limit = Math.min(Number(c.req.query('limit') || 100), MAX_LIMIT)
  const filters: string[] = []
  const params: (string | number)[] = []

  if (from) {
    filters.push('spent_at >= ?')
    params.push(from)
  }
  if (to) {
    filters.push('spent_at <= ?')
    params.push(to)
  }
  if (category) {
    filters.push('category = ?')
    params.push(category)
  }
  if (q) {
    filters.push('note LIKE ?')
    params.push(`%${q}%`)
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
  const sql = `SELECT id, amount, category, note, spent_at, created_at, updated_at FROM expenses ${where} ORDER BY spent_at DESC, id DESC LIMIT ?`
  params.push(Number.isFinite(limit) ? limit : 100)

  console.log('Listing expenses', { from, to, category, hasSearch: Boolean(q), limit: params.at(-1) })
  const result = await c.env.DB.prepare(sql).bind(...params).all<ExpenseRow>()
  return c.json({ expenses: result.results.map(serializeExpense) })
})

app.post('/api/expenses', async (c) => {
  const input = await c.req.json<ExpenseInput>()
  const validation = validateExpense(input)
  if (validation.error) {
    console.error('Expense creation validation failed', { error: validation.error })
    return c.json({ error: validation.error, details: validation.error }, 400)
  }

  const now = new Date().toISOString()
  if (!validation.value) {
    console.error('Expense validation produced no value unexpectedly')
    return c.json({ error: 'invalid expense payload', details: 'validation returned empty value' }, 400)
  }

  const { amount, category, note, spentAt } = validation.value
  const result = await c.env.DB.prepare(
    'INSERT INTO expenses (amount, category, note, spent_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id, amount, category, note, spent_at, created_at, updated_at',
  )
    .bind(amount, category, note, spentAt, now, now)
    .first<ExpenseRow>()

  if (!result) {
    console.error('D1 insert returned no row')
    return c.json({ error: 'failed to create expense', details: 'database insert returned no row' }, 500)
  }

  await clearStatsCache(c.env.CACHE)
  console.log('Created expense', { id: result.id, category: result.category, amount: result.amount })
  return c.json({ expense: serializeExpense(result) }, 201)
})

app.put('/api/expenses/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) {
    console.error('Invalid expense id for update', { id: c.req.param('id') })
    return c.json({ error: 'invalid expense id', details: 'id must be a positive integer' }, 400)
  }

  const input = await c.req.json<ExpenseInput>()
  const validation = validateExpense(input)
  if (validation.error) {
    console.error('Expense update validation failed', { id, error: validation.error })
    return c.json({ error: validation.error, details: validation.error }, 400)
  }

  const now = new Date().toISOString()
  if (!validation.value) {
    console.error('Expense update validation produced no value unexpectedly', { id })
    return c.json({ error: 'invalid expense payload', details: 'validation returned empty value' }, 400)
  }

  const { amount, category, note, spentAt } = validation.value
  const result = await c.env.DB.prepare(
    'UPDATE expenses SET amount = ?, category = ?, note = ?, spent_at = ?, updated_at = ? WHERE id = ? RETURNING id, amount, category, note, spent_at, created_at, updated_at',
  )
    .bind(amount, category, note, spentAt, now, id)
    .first<ExpenseRow>()

  if (!result) {
    console.error('Expense not found for update', { id })
    return c.json({ error: 'expense not found', details: 'no record matched the given id' }, 404)
  }

  await clearStatsCache(c.env.CACHE)
  console.log('Updated expense', { id })
  return c.json({ expense: serializeExpense(result) })
})

app.delete('/api/expenses/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) {
    console.error('Invalid expense id for delete', { id: c.req.param('id') })
    return c.json({ error: 'invalid expense id', details: 'id must be a positive integer' }, 400)
  }

  const result = await c.env.DB.prepare('DELETE FROM expenses WHERE id = ?').bind(id).run()
  if (!result.meta.changes) {
    console.error('Expense not found for delete', { id })
    return c.json({ error: 'expense not found', details: 'no record matched the given id' }, 404)
  }

  await clearStatsCache(c.env.CACHE)
  console.log('Deleted expense', { id })
  return c.json({ ok: true })
})

app.get('/api/stats', async (c) => {
  const from = c.req.query('from') || ''
  const to = c.req.query('to') || ''
  const cacheKey = `${STATS_CACHE_PREFIX}${from}:${to}`
  const cached = await c.env.CACHE.get(cacheKey, 'json')
  if (cached) {
    console.log('Stats cache hit', { from, to })
    return c.json(cached)
  }

  const filters: string[] = []
  const params: string[] = []
  if (from) {
    filters.push('spent_at >= ?')
    params.push(from)
  }
  if (to) {
    filters.push('spent_at <= ?')
    params.push(to)
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''

  console.log('Computing stats from D1', { from, to })
  const [summary, byCategory, byMonth] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM expenses ${where}`).bind(...params).first(),
    c.env.DB.prepare(`SELECT category, COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM expenses ${where} GROUP BY category ORDER BY total DESC`).bind(...params).all(),
    c.env.DB.prepare(`SELECT substr(spent_at, 1, 7) as month, COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM expenses ${where} GROUP BY month ORDER BY month DESC`).bind(...params).all(),
  ])

  const payload = { summary, byCategory: byCategory.results, byMonth: byMonth.results }
  await c.env.CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl: 300 })
  return c.json(payload)
})

function validateExpense(input: ExpenseInput):
  | { value: { amount: number; category: string; note: string; spentAt: string }; error?: never }
  | { value?: never; error: string } {
  const amount = Number(input.amount)
  const category = typeof input.category === 'string' ? input.category.trim() : ''
  const note = typeof input.note === 'string' ? input.note.trim() : ''
  const spentAt = typeof input.spentAt === 'string' ? input.spentAt : ''

  if (!Number.isFinite(amount) || amount <= 0) return { error: 'amount must be greater than 0' }
  if (!category) return { error: 'category is required' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spentAt)) return { error: 'spentAt must be a YYYY-MM-DD date' }

  return { value: { amount, category, note, spentAt } }
}

function serializeExpense(row: ExpenseRow) {
  return {
    id: row.id,
    amount: row.amount,
    category: row.category,
    note: row.note,
    spentAt: row.spent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function clearStatsCache(cache: KVNamespace) {
  const list = await cache.list({ prefix: STATS_CACHE_PREFIX })
  await Promise.all(list.keys.map((key) => cache.delete(key.name)))
  console.log('Cleared stats cache keys', { count: list.keys.length })
}

export default app