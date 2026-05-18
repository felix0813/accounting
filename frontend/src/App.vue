<script setup>
import { computed, onMounted, reactive, ref } from 'vue'

const toDateInputValue = (date) => date.toISOString().slice(0, 10)
const formatCurrency = (value) => new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY'
}).format(Number(value || 0))
const maxTotal = (rows) => Math.max(0, ...rows.map((row) => Number(row.total || 0)))

const today = new Date()
const firstDay = new Date(today.getFullYear(), today.getMonth(), 1)

const apiBase = ref(localStorage.getItem('accounting.apiBase') || 'http://localhost:8787')
const categories = ref([])
const expenses = ref([])
const editingId = ref(null)
const message = ref('')
const messageType = ref('success')
const messageTimer = ref(undefined)
const form = reactive({
  amount: '',
  category: '',
  note: '',
  spentAt: toDateInputValue(today)
})
const filters = reactive({
  from: toDateInputValue(firstDay),
  to: toDateInputValue(today),
  category: '',
  q: ''
})
const summary = ref({ total: 0, count: 0 })
const byCategory = ref([])
const byMonth = ref([])

const total = computed(() => Number(summary.value.total || 0))
const count = computed(() => Number(summary.value.count || 0))
const average = computed(() => (count.value ? total.value / count.value : 0))
const categoryMax = computed(() => maxTotal(byCategory.value))
const monthMax = computed(() => maxTotal(byMonth.value))
const submitLabel = computed(() => (editingId.value ? '保存修改' : '添加开销'))

const endpoint = (path) => apiBase.value.replace(/\/$/, '') + path

const request = async (path, options = {}) => {
  const response = await fetch(endpoint(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error || '请求失败')
  }
  return payload
}

const queryString = (includeCategory = true) => {
  const params = new URLSearchParams()
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (includeCategory && filters.category) params.set('category', filters.category)
  if (filters.q) params.set('q', filters.q)
  return params.toString() ? `?${params.toString()}` : ''
}

const showMessage = (text, type = 'success') => {
  message.value = text
  messageType.value = type
  window.clearTimeout(messageTimer.value)
  messageTimer.value = window.setTimeout(() => {
    message.value = ''
  }, 3000)
}

const loadCategories = async () => {
  const payload = await request('/api/categories')
  categories.value = payload.categories || []
  if (!form.category && categories.value.length) {
    form.category = categories.value[0]
  }
}

const loadExpenses = async () => {
  const payload = await request(`/api/expenses${queryString()}`)
  expenses.value = payload.expenses || []
}

const loadStats = async () => {
  const payload = await request(`/api/stats${queryString(false)}`)
  summary.value = payload.summary || { total: 0, count: 0 }
  byCategory.value = payload.byCategory || []
  byMonth.value = payload.byMonth || []
}

const refresh = async () => {
  await Promise.all([loadExpenses(), loadStats()])
}

const initialize = async () => {
  try {
    await loadCategories()
    await refresh()
  } catch (error) {
    showMessage(error instanceof Error ? error.message : '初始化失败', 'error')
  }
}

const resetForm = () => {
  editingId.value = null
  form.amount = ''
  form.category = categories.value[0] || ''
  form.note = ''
  form.spentAt = toDateInputValue(new Date())
}

const submitExpense = async () => {
  const payload = {
    amount: Number(form.amount),
    category: form.category,
    note: form.note,
    spentAt: form.spentAt
  }

  try {
    if (editingId.value) {
      await request(`/api/expenses/${editingId.value}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      })
      showMessage('开销已更新')
    } else {
      await request('/api/expenses', {
        method: 'POST',
        body: JSON.stringify(payload)
      })
      showMessage('开销已添加')
    }
    resetForm()
    await refresh()
  } catch (error) {
    showMessage(error instanceof Error ? error.message : '保存失败', 'error')
  }
}

const editExpense = (expense) => {
  editingId.value = expense.id
  form.amount = String(expense.amount)
  form.category = expense.category
  form.note = expense.note || ''
  form.spentAt = expense.spentAt
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

const deleteExpense = async (id) => {
  if (!window.confirm('确定删除这笔开销吗？')) return

  try {
    await request(`/api/expenses/${id}`, { method: 'DELETE' })
    showMessage('开销已删除')
    await refresh()
  } catch (error) {
    showMessage(error instanceof Error ? error.message : '删除失败', 'error')
  }
}

const resetFilters = () => {
  filters.from = ''
  filters.to = ''
  filters.category = ''
  filters.q = ''
  refresh().catch((error) => showMessage(error instanceof Error ? error.message : '刷新失败', 'error'))
}

const saveApiBase = () => {
  localStorage.setItem('accounting.apiBase', apiBase.value)
  refresh()
    .then(() => showMessage('后端地址已保存'))
    .catch((error) => showMessage(error instanceof Error ? error.message : '刷新失败', 'error'))
}

const statWidth = (value, max) => `${max ? Math.round((Number(value || 0) / max) * 100) : 0}%`

onMounted(initialize)
</script>

<template>
  <main class="app-shell">
    <header class="hero">
      <div>
        <p class="eyebrow">Personal accounting</p>
        <h1>个人记账</h1>
        <p>记录日常开销，按时间、类别和备注快速筛选，并查看聚合统计。</p>
      </div>
      <label class="api-field">
        后端 API 地址
        <input v-model="apiBase" placeholder="http://localhost:8787" @change="saveApiBase" />
      </label>
    </header>

    <section class="grid-two">
      <form class="panel expense-form" @submit.prevent="submitExpense">
        <h2>{{ editingId ? '编辑开销' : '新增开销' }}</h2>
        <label>
          金额
          <input v-model="form.amount" type="number" min="0" step="0.01" required placeholder="88.50" />
        </label>
        <label>
          类别
          <select v-model="form.category" required>
            <option v-for="category in categories" :key="category" :value="category">{{ category }}</option>
          </select>
        </label>
        <label>
          日期
          <input v-model="form.spentAt" type="date" required />
        </label>
        <label class="full">
          备注
          <input v-model="form.note" maxlength="120" placeholder="午餐、地铁、电影票..." />
        </label>
        <button id="submit-expense" type="submit">{{ submitLabel }}</button>
        <p class="message" :class="message ? messageType : ''">{{ message }}</p>
      </form>

      <aside class="stats-cards">
        <article>
          <span>总支出</span>
          <strong>{{ formatCurrency(total) }}</strong>
        </article>
        <article>
          <span>记录数</span>
          <strong>{{ count }}</strong>
        </article>
        <article>
          <span>平均单笔</span>
          <strong>{{ formatCurrency(average) }}</strong>
        </article>
      </aside>
    </section>

    <section class="panel filters">
      <label>
        开始日期
        <input v-model="filters.from" type="date" />
      </label>
      <label>
        结束日期
        <input v-model="filters.to" type="date" />
      </label>
      <label>
        类别
        <select v-model="filters.category">
          <option value="">全部类别</option>
          <option v-for="category in categories" :key="category" :value="category">{{ category }}</option>
        </select>
      </label>
      <label>
        备注搜索
        <input v-model="filters.q" placeholder="搜索备注" @keyup.enter="refresh" />
      </label>
      <button type="button" @click="refresh">应用筛选</button>
      <button type="button" class="secondary" @click="resetFilters">重置</button>
    </section>

    <section class="content-grid">
      <div class="panel">
        <h2>开销记录</h2>
        <div class="expense-list">
          <article v-for="expense in expenses" :key="expense.id" class="expense-card">
            <div>
              <strong>{{ expense.category }}</strong>
              <p>{{ expense.note || '无备注' }}</p>
              <time>{{ expense.spentAt }}</time>
            </div>
            <div class="expense-actions">
              <span>{{ formatCurrency(expense.amount) }}</span>
              <button type="button" @click="editExpense(expense)">编辑</button>
              <button type="button" class="danger" @click="deleteExpense(expense.id)">删除</button>
            </div>
          </article>
          <div v-if="!expenses.length" class="empty">当前筛选条件下暂无开销记录</div>
        </div>
      </div>

      <aside class="panel insights">
        <h2>统计洞察</h2>
        <h3>按类别</h3>
        <ul class="bar-list">
          <li v-for="row in byCategory" :key="row.category">
            <span>{{ row.category }}</span>
            <b>{{ formatCurrency(row.total) }}</b>
            <i :style="{ width: statWidth(row.total, categoryMax) }"></i>
          </li>
          <li v-if="!byCategory.length">暂无统计数据</li>
        </ul>

        <h3>按月份</h3>
        <ul class="bar-list">
          <li v-for="row in byMonth" :key="row.month">
            <span>{{ row.month }}</span>
            <b>{{ formatCurrency(row.total) }}</b>
            <i :style="{ width: statWidth(row.total, monthMax) }"></i>
          </li>
          <li v-if="!byMonth.length">暂无统计数据</li>
        </ul>
      </aside>
    </section>
  </main>
</template>
