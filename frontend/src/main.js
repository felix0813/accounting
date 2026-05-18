import { createApp } from 'https://unpkg.com/vue@3.5.13/dist/vue.esm-browser.prod.js'

const toDateInputValue = (date) => date.toISOString().slice(0, 10)
const formatCurrency = (value) => new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY'
}).format(Number(value || 0))
const maxTotal = (rows) => Math.max(0, ...rows.map((row) => Number(row.total || 0)))

createApp({
  data() {
    const today = new Date()
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1)

    return {
      apiBase: localStorage.getItem('accounting.apiBase') || 'http://localhost:8787',
      categories: [],
      expenses: [],
      editingId: null,
      message: '',
      messageType: 'success',
      messageTimer: undefined,
      form: {
        amount: '',
        category: '',
        note: '',
        spentAt: toDateInputValue(today)
      },
      filters: {
        from: toDateInputValue(firstDay),
        to: toDateInputValue(today),
        category: '',
        q: ''
      },
      summary: { total: 0, count: 0 },
      byCategory: [],
      byMonth: []
    }
  },
  computed: {
    total() {
      return Number(this.summary.total || 0)
    },
    count() {
      return Number(this.summary.count || 0)
    },
    average() {
      return this.count ? this.total / this.count : 0
    },
    categoryMax() {
      return maxTotal(this.byCategory)
    },
    monthMax() {
      return maxTotal(this.byMonth)
    },
    submitLabel() {
      return this.editingId ? '保存修改' : '添加开销'
    }
  },
  mounted() {
    this.initialize()
  },
  methods: {
    endpoint(path) {
      return this.apiBase.replace(/\/$/, '') + path
    },
    async request(path, options = {}) {
      const response = await fetch(this.endpoint(path), {
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
    },
    queryString(includeCategory = true) {
      const params = new URLSearchParams()
      if (this.filters.from) params.set('from', this.filters.from)
      if (this.filters.to) params.set('to', this.filters.to)
      if (includeCategory && this.filters.category) params.set('category', this.filters.category)
      if (this.filters.q) params.set('q', this.filters.q)
      return params.toString() ? `?${params.toString()}` : ''
    },
    async loadCategories() {
      const payload = await this.request('/api/categories')
      this.categories = payload.categories || []
      if (!this.form.category && this.categories.length) {
        this.form.category = this.categories[0]
      }
    },
    async loadExpenses() {
      const payload = await this.request(`/api/expenses${this.queryString()}`)
      this.expenses = payload.expenses || []
    },
    async loadStats() {
      const payload = await this.request(`/api/stats${this.queryString(false)}`)
      this.summary = payload.summary || { total: 0, count: 0 }
      this.byCategory = payload.byCategory || []
      this.byMonth = payload.byMonth || []
    },
    async refresh() {
      await Promise.all([this.loadExpenses(), this.loadStats()])
    },
    async initialize() {
      try {
        await this.loadCategories()
        await this.refresh()
      } catch (error) {
        this.showMessage(error instanceof Error ? error.message : '初始化失败', 'error')
      }
    },
    async submitExpense() {
      const payload = {
        amount: Number(this.form.amount),
        category: this.form.category,
        note: this.form.note,
        spentAt: this.form.spentAt
      }

      try {
        if (this.editingId) {
          await this.request(`/api/expenses/${this.editingId}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
          })
          this.showMessage('开销已更新')
        } else {
          await this.request('/api/expenses', {
            method: 'POST',
            body: JSON.stringify(payload)
          })
          this.showMessage('开销已添加')
        }
        this.resetForm()
        await this.refresh()
      } catch (error) {
        this.showMessage(error instanceof Error ? error.message : '保存失败', 'error')
      }
    },
    editExpense(expense) {
      this.editingId = expense.id
      this.form.amount = String(expense.amount)
      this.form.category = expense.category
      this.form.note = expense.note || ''
      this.form.spentAt = expense.spentAt
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    async deleteExpense(id) {
      if (!window.confirm('确定删除这笔开销吗？')) return

      try {
        await this.request(`/api/expenses/${id}`, { method: 'DELETE' })
        this.showMessage('开销已删除')
        await this.refresh()
      } catch (error) {
        this.showMessage(error instanceof Error ? error.message : '删除失败', 'error')
      }
    },
    resetForm() {
      this.editingId = null
      this.form.amount = ''
      this.form.category = this.categories[0] || ''
      this.form.note = ''
      this.form.spentAt = toDateInputValue(new Date())
    },
    resetFilters() {
      this.filters.from = ''
      this.filters.to = ''
      this.filters.category = ''
      this.filters.q = ''
      this.refresh().catch((error) => this.showMessage(error instanceof Error ? error.message : '刷新失败', 'error'))
    },
    saveApiBase() {
      localStorage.setItem('accounting.apiBase', this.apiBase)
      this.refresh()
        .then(() => this.showMessage('后端地址已保存'))
        .catch((error) => this.showMessage(error instanceof Error ? error.message : '刷新失败', 'error'))
    },
    showMessage(text, type = 'success') {
      this.message = text
      this.messageType = type
      window.clearTimeout(this.messageTimer)
      this.messageTimer = window.setTimeout(() => {
        this.message = ''
      }, 3000)
    },
    formatCurrency,
    statWidth(total, max) {
      return `${max ? Math.round((Number(total || 0) / max) * 100) : 0}%`
    }
  },
  template: `
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
  `
}).mount('#app')
