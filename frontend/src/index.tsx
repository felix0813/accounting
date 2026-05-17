import { Hono } from 'hono'
import { renderer } from './renderer'

const app = new Hono()

app.use(renderer)

const clientScript = String.raw`
const defaultApiBase = localStorage.getItem('accounting.apiBase') || 'http://localhost:8787'
const state = {
  apiBase: defaultApiBase,
  categories: [],
  expenses: [],
  editingId: null,
}

const elements = {
  apiBase: document.querySelector('#api-base'),
  form: document.querySelector('#expense-form'),
  amount: document.querySelector('#amount'),
  category: document.querySelector('#category'),
  note: document.querySelector('#note'),
  spentAt: document.querySelector('#spent-at'),
  from: document.querySelector('#from'),
  to: document.querySelector('#to'),
  filterCategory: document.querySelector('#filter-category'),
  search: document.querySelector('#search'),
  reset: document.querySelector('#reset-filters'),
  list: document.querySelector('#expense-list'),
  message: document.querySelector('#message'),
  total: document.querySelector('#total'),
  count: document.querySelector('#count'),
  average: document.querySelector('#average'),
  categoryStats: document.querySelector('#category-stats'),
  monthStats: document.querySelector('#month-stats'),
  submit: document.querySelector('#submit-expense'),
}

elements.apiBase.value = state.apiBase
elements.spentAt.valueAsDate = new Date()
const today = new Date()
const firstDay = new Date(today.getFullYear(), today.getMonth(), 1)
elements.from.value = firstDay.toISOString().slice(0, 10)
elements.to.value = today.toISOString().slice(0, 10)

function endpoint(path) {
  return state.apiBase.replace(/\/$/, '') + path
}

async function request(path, options = {}) {
  const response = await fetch(endpoint(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload.error || '请求失败')
  }
  return payload
}

function showMessage(text, type = 'success') {
  elements.message.textContent = text
  elements.message.className = 'message ' + type
  window.setTimeout(() => {
    elements.message.textContent = ''
    elements.message.className = 'message'
  }, 3000)
}

function queryString(includeCategory = true) {
  const params = new URLSearchParams()
  if (elements.from.value) params.set('from', elements.from.value)
  if (elements.to.value) params.set('to', elements.to.value)
  if (includeCategory && elements.filterCategory.value) params.set('category', elements.filterCategory.value)
  if (elements.search.value) params.set('q', elements.search.value)
  return params.toString() ? '?' + params.toString() : ''
}

async function loadCategories() {
  const payload = await request('/api/categories')
  state.categories = payload.categories
  renderCategoryOptions()
}

async function loadExpenses() {
  const payload = await request('/api/expenses' + queryString())
  state.expenses = payload.expenses
  renderExpenses()
}

async function loadStats() {
  const payload = await request('/api/stats' + queryString(false))
  const total = Number(payload.summary?.total || 0)
  const count = Number(payload.summary?.count || 0)
  elements.total.textContent = formatCurrency(total)
  elements.count.textContent = String(count)
  elements.average.textContent = formatCurrency(count ? total / count : 0)
  renderStats(elements.categoryStats, payload.byCategory || [], 'category')
  renderStats(elements.monthStats, payload.byMonth || [], 'month')
}

async function refresh() {
  await Promise.all([loadExpenses(), loadStats()])
}

function renderCategoryOptions() {
  elements.category.innerHTML = state.categories.map((category) => '<option value="' + escapeHtml(category) + '">' + escapeHtml(category) + '</option>').join('')
  elements.filterCategory.innerHTML = '<option value="">全部类别</option>' + state.categories.map((category) => '<option value="' + escapeHtml(category) + '">' + escapeHtml(category) + '</option>').join('')
}

function renderExpenses() {
  if (!state.expenses.length) {
    elements.list.innerHTML = '<div class="empty">当前筛选条件下暂无开销记录</div>'
    return
  }

  elements.list.innerHTML = state.expenses.map((expense) => (
    '<article class="expense-card">' +
      '<div>' +
        '<strong>' + escapeHtml(expense.category) + '</strong>' +
        '<p>' + escapeHtml(expense.note || '无备注') + '</p>' +
        '<time>' + expense.spentAt + '</time>' +
      '</div>' +
      '<div class="expense-actions">' +
        '<span>' + formatCurrency(expense.amount) + '</span>' +
        '<button data-edit="' + expense.id + '">编辑</button>' +
        '<button class="danger" data-delete="' + expense.id + '">删除</button>' +
      '</div>' +
    '</article>'
  )).join('')
}

function renderStats(target, rows, labelKey) {
  if (!rows.length) {
    target.innerHTML = '<li>暂无统计数据</li>'
    return
  }

  const max = Math.max(...rows.map((row) => Number(row.total || 0)))
  target.innerHTML = rows.map((row) => {
    const total = Number(row.total || 0)
    const percent = max ? Math.round((total / max) * 100) : 0
    return '<li><span>' + escapeHtml(row[labelKey]) + '</span><b>' + formatCurrency(total) + '</b><i style="width:' + percent + '%"></i></li>'
  }).join('')
}

function formatCurrency(value) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(Number(value || 0))
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char])
}

elements.form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const payload = {
    amount: Number(elements.amount.value),
    category: elements.category.value,
    note: elements.note.value,
    spentAt: elements.spentAt.value,
  }
  const path = state.editingId ? '/api/expenses/' + state.editingId : '/api/expenses'
  const method = state.editingId ? 'PUT' : 'POST'
  await request(path, { method, body: JSON.stringify(payload) })
  elements.form.reset()
  elements.spentAt.valueAsDate = new Date()
  state.editingId = null
  elements.submit.textContent = '记录开销'
  showMessage(method === 'POST' ? '开销已记录' : '开销已更新')
  await refresh()
})

elements.list.addEventListener('click', async (event) => {
  const editId = event.target.dataset.edit
  const deleteId = event.target.dataset.delete
  if (editId) {
    const expense = state.expenses.find((item) => item.id === Number(editId))
    if (!expense) return
    state.editingId = expense.id
    elements.amount.value = expense.amount
    elements.category.value = expense.category
    elements.note.value = expense.note
    elements.spentAt.value = expense.spentAt
    elements.submit.textContent = '保存修改'
  }
  if (deleteId && confirm('确认删除这笔开销吗？')) {
    await request('/api/expenses/' + deleteId, { method: 'DELETE' })
    showMessage('开销已删除')
    await refresh()
  }
})

for (const input of [elements.from, elements.to, elements.filterCategory, elements.search]) {
  input.addEventListener('change', refresh)
}
elements.search.addEventListener('input', () => window.clearTimeout(window.searchTimer) || (window.searchTimer = window.setTimeout(refresh, 300)))
elements.reset.addEventListener('click', () => {
  elements.from.value = ''
  elements.to.value = ''
  elements.filterCategory.value = ''
  elements.search.value = ''
  refresh()
})
elements.apiBase.addEventListener('change', async () => {
  state.apiBase = elements.apiBase.value
  localStorage.setItem('accounting.apiBase', state.apiBase)
  await bootstrap()
})

async function bootstrap() {
  try {
    await loadCategories()
    await refresh()
  } catch (error) {
    showMessage(error.message || '加载失败，请检查后端地址和 Cloudflare 绑定配置', 'error')
  }
}

bootstrap()
`

app.get('/', (c) => {
  return c.render(
    <main class="app-shell">
      <section class="hero">
        <div>
          <p class="eyebrow">Cloudflare Pages · Workers · KV · D1</p>
          <h1>个人记账</h1>
          <p>记录日常开销，按时间与类别筛选，并快速查看汇总统计。</p>
        </div>
        <label class="api-field">
          后端 API 地址
          <input id="api-base" placeholder="http://localhost:8787" />
        </label>
      </section>

      <section class="panel grid-two">
        <form id="expense-form" class="expense-form">
          <h2>新增开销</h2>
          <label>
            金额
            <input id="amount" type="number" min="0.01" step="0.01" required placeholder="例如 36.50" />
          </label>
          <label>
            类别
            <select id="category" required></select>
          </label>
          <label>
            日期
            <input id="spent-at" type="date" required />
          </label>
          <label class="full">
            备注
            <input id="note" maxlength="120" placeholder="午餐、地铁、电影票..." />
          </label>
          <button id="submit-expense" type="submit">记录开销</button>
          <p id="message" class="message" role="status"></p>
        </form>

        <div class="stats-cards">
          <article><span>总支出</span><strong id="total">¥0.00</strong></article>
          <article><span>记录数</span><strong id="count">0</strong></article>
          <article><span>平均每笔</span><strong id="average">¥0.00</strong></article>
        </div>
      </section>

      <section class="panel filters">
        <label>开始日期<input id="from" type="date" /></label>
        <label>结束日期<input id="to" type="date" /></label>
        <label>类别<select id="filter-category"></select></label>
        <label>搜索备注<input id="search" placeholder="输入关键词" /></label>
        <button id="reset-filters" type="button">清空筛选</button>
      </section>

      <section class="content-grid">
        <div class="panel">
          <h2>开销明细</h2>
          <div id="expense-list" class="expense-list"></div>
        </div>
        <aside class="panel insights">
          <h2>统计</h2>
          <h3>按类别</h3>
          <ul id="category-stats" class="bar-list"></ul>
          <h3>按月份</h3>
          <ul id="month-stats" class="bar-list"></ul>
        </aside>
      </section>
      <script dangerouslySetInnerHTML={{ __html: clientScript }} />
    </main>,
  )
})

export default app
