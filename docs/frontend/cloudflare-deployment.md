# 前端部署到 Cloudflare Workers

`apps/web` 是 Next.js 应用，并且包含动态路由，因此通过 OpenNext 部署到 Cloudflare Workers，而不是按纯静态站点部署到 Pages。

## 前置条件

- Node.js 与 pnpm 版本应与项目保持一致。
- Cloudflare 账号已启用 Workers。
- 后端已有公网 HTTPS 地址，并支持 WebSocket。

首次在本机登录 Cloudflare：

```bash
pnpm --filter web exec wrangler login
pnpm --filter web exec wrangler whoami
```

CI 中不要执行交互登录，改为设置权限受限的 `CLOUDFLARE_API_TOKEN`。

## 配置生产环境

Next.js 会在构建时内联所有 `NEXT_PUBLIC_*` 变量，因此必须在构建前设置：

本机可以直接使用已被 Git 忽略的 `apps/web/.env.production`：

```dotenv
NEXT_PUBLIC_SERVER_URL=https://api.example.com
NEXT_PUBLIC_REOWN_PROJECT_ID=your-reown-project-id
# 可选：Sentry 浏览器端报错收集。不配 = 完全不启用。必须是 web 专用的 DSN，和后端的不是同一个
NEXT_PUBLIC_SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project-id>
```

`.env.production.local` 和已有 shell 环境变量的优先级更高。CI 中通过环境变量提供配置：

```bash
export NEXT_PUBLIC_SERVER_URL="https://api.example.com"
export NEXT_PUBLIC_REOWN_PROJECT_ID="your-reown-project-id"
export NEXT_PUBLIC_SENTRY_DSN="https://<key>@<org>.ingest.sentry.io/<project-id>"   # 可选
```

`NEXT_PUBLIC_SENTRY_DSN` 同样是**构建期内联**：新增、更换或删除它之后都必须重新执行 `deploy:web` 才会生效；漏配的后果是线上静默不上报，不会报错。上线后用浏览器控制台执行 `Promise.reject(new Error("sentry-probe"))`，到 Sentry 项目里确认收到事件。

`NEXT_PUBLIC_SERVER_URL` 不要以 `/` 结尾。浏览器会由它派生 WebSocket 地址，例如 `https://api.example.com` 对应 `wss://api.example.com/ws`。

后端也必须同步配置：

- `CORS_ORIGIN=https://app.example.com`
- `GOOGLE_REDIRECT_URI=https://api.example.com/auth/google/callback`
- Google Cloud Console 中加入完全相同的重定向 URI

环境文件不要提交到 Git，CI 使用部署平台的 Secret。前端 `NEXT_PUBLIC_*` 是公开配置，不能放后端密钥。

## 构建、预览与部署

在仓库根目录执行：

```bash
pnpm --filter web build:cloudflare
pnpm --filter web preview:cloudflare
pnpm run deploy:web
```

`deploy:web` 会依次构建和发布前端，不会重启后端。后端独立使用
`pnpm run deploy:server`，读取 `apps/server/.env.docker` 和 `.env.tunnel`。

部署使用 `apps/web/wrangler.jsonc`，Worker 名称为 `binance-contract-trading-full-stack-web`。首次部署完成后会获得 `*.workers.dev` 地址。

## 自定义域名

在 Cloudflare Dashboard 的 Worker 设置中添加 Custom Domain（例如 `app.example.com`），然后把后端 `CORS_ORIGIN` 改为该正式域名。若切换 API 域名，需要重新构建并部署前端，因为 `NEXT_PUBLIC_SERVER_URL` 是构建时变量。

## Git 自动部署

在 CI 中按以下顺序执行：

```bash
pnpm install --frozen-lockfile
pnpm run deploy:web
```

CI 需要提供 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`NEXT_PUBLIC_SERVER_URL` 和 `NEXT_PUBLIC_REOWN_PROJECT_ID`；要启用浏览器端报错收集时再加 `NEXT_PUBLIC_SENTRY_DSN`（可选）。Token 仅授予目标账号的 Workers Scripts 编辑权限。
