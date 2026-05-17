# Accounting Frontend

Cloudflare Pages/Workers 前端，用 Hono JSX 渲染个人记账页面。页面会调用后端 REST API，支持记录、编辑、删除开销，以及按日期、类别、备注筛选并查看统计。

## 本地启动

```txt
npm install
npm run dev
```

默认后端地址为 `http://localhost:8787`，也可以在页面右上角修改并保存到浏览器本地存储。

## 部署

```txt
npm run deploy
```

部署后请在后端 `ALLOWED_ORIGIN` 中配置前端域名。

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```txt
npm run cf-typegen
```
