# Accounting Frontend

Cloudflare Pages 静态前端，使用 Vue 3 重写个人记账页面。页面会调用后端 REST API，支持记录、编辑、删除开销，以及按日期、类别、备注筛选并查看统计。

## 本地启动

```txt
npm install
npm run dev
```

默认后端地址为 `http://localhost:8787`，也可以在页面右上角修改并保存到浏览器本地存储。

## 部署到 Cloudflare Pages

Cloudflare Pages 中建议配置：

- Build command: `npm run build`
- Build output directory: `dist`

部署后请在后端 `ALLOWED_ORIGIN` 中配置前端域名。
