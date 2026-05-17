# Accounting Backend

Cloudflare Workers 后端，使用 Hono 提供 REST API，D1 保存开销明细，KV 保存类别配置和短期统计缓存。

## 本地启动

```txt
npm install
npm run db:migrate:local
npm run dev
```

## API

- `GET /health`：健康检查。
- `GET /api/categories`：读取类别，优先从 KV 获取。
- `PUT /api/categories`：更新类别并写入 KV。
- `GET /api/expenses`：按 `from`、`to`、`category`、`q` 筛选开销。
- `POST /api/expenses`：新增开销。
- `PUT /api/expenses/:id`：修改开销。
- `DELETE /api/expenses/:id`：删除开销。
- `GET /api/stats`：按时间范围汇总总额、类别和月份统计，结果短期缓存到 KV。

## Cloudflare 绑定

部署前在 `wrangler.jsonc` 中替换 D1 与 KV 的 id，并按需配置 `ALLOWED_ORIGIN` 为前端 Pages 域名。
