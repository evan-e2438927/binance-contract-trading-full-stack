# binance-contract-trading-full-stack

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines Next.js, Hono, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **Next.js** - Full-stack React framework
- **React Native** - Build mobile apps using React
- **Expo** - Tools for React Native development
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Hono** - Lightweight, performant server framework
- **Node.js** - Runtime environment
- **Drizzle** - TypeScript-first ORM
- **PostgreSQL** - Database engine
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
pnpm install
```

## Database Setup

This project uses PostgreSQL with Drizzle ORM.

1. Make sure you have a PostgreSQL database set up.
2. Update your `apps/server/.env` file with your PostgreSQL connection details.

3. Apply the schema to your database:

```bash
pnpm run db:push
```

Then, run the development server:

```bash
pnpm run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the web application.
Use the Expo Go app to run the mobile application.
The API is running at [http://localhost:3000](http://localhost:3000).

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@binance-contract-trading-full-stack/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Environment Configuration

Each app owns its environment schema in `.env.schema`. Varlock generates `src/env.ts` during installation; run `pnpm run env:generate` after changing a schema. Commit schemas, and keep secrets in ignored env files or your deployment platform.

Import the generated `ENV` accessor in application code. Shared database and auth packages receive configuration or initialized clients from the application. See [Varlock's monorepo guide](https://varlock.dev/guides/monorepos/).

For Cloudflare, Alchemy loads and validates deployment inputs with `varlock/auto-load` in its Node/Bun deployment process. Worker code reads native bindings; web clients use the framework's public env API through `src/env.public.ts` where needed. Alchemy supplies resource URLs and managed database credentials. In-Worker Varlock protections are deferred until an official Alchemy integration is available; see [the non-Wrangler deployment guidance](https://varlock.dev/integrations/cloudflare/#non-wrangler-deploy-tools-alchemy-sst-pulumi).

Bun's automatic env loading is disabled in `bunfig.toml`; the framework integration or server bootstrap loads Varlock. Node deployments must include Varlock and its dependencies alongside the app schema.

## Deployment

Run these commands from the repository root to release each app independently:

```bash
pnpm run deploy:server  # Build and start the local Docker backend + tunnel
pnpm run deploy:web     # Build and publish the frontend to Cloudflare Workers
```

`deploy:server` uses the current Docker context and waits up to 120 seconds after
startup for the backend health check. It does not build or publish the frontend.
`deploy:web` uses the existing OpenNext / Wrangler configuration and does not
restart the backend. The original `deploy` command still uses Alchemy.

| Env file | Used by |
| --- | --- |
| `apps/server/.env.docker` | Docker backend runtime (optional `SENTRY_DSN` / `SENTRY_RELEASE` enable server error reporting) |
| `apps/server/.env.production` | Direct server startup with `NODE_ENV=production` |
| `apps/server/.env.tunnel` | Cloudflare Tunnel connector |
| `apps/web/.env.production` | Frontend production build (optional `NEXT_PUBLIC_SENTRY_DSN`, inlined at build time) |

The Docker backend does not read `apps/server/.env.production`. If Docker is your
only backend deployment method, maintain `.env.docker`; `.env.production` is only
needed for direct production startup outside Docker. These ignored files are
independent copies, so changes are not synchronized between them.

Sentry is optional on both sides and disabled when its DSN is empty. The server and
the web app must use two different Sentry projects, so `SENTRY_DSN` and
`NEXT_PUBLIC_SENTRY_DSN` are different values. See `docs/design/09-monitoring.md`.

Development and production must use different `JWT_SECRET` values. Node and
Docker deployments of the same production environment should use the same
production key. Rotating that key invalidates existing login tokens. Use
separate databases for development and production; a different hostname or
env filename alone does not isolate the persisted trading state.

### Server in Docker

The server image uses the existing `build` / `start` flow: tsdown builds
`dist/index.mjs`, and Node 24 runs it with production dependencies and the Varlock
schema. It does not use the Bun `compile` script. Build from the repository root
so Docker can resolve the workspace packages.

Create an ignored runtime env file (use `.env` instead if starting with local
development settings):

```bash
cp apps/server/.env.production apps/server/.env.docker
```

Edit `apps/server/.env.docker` with the database URL, Binance credentials,
JWT secret, and the browser-facing `CORS_ORIGIN`. To connect to local Supabase
on Docker Desktop, use:

```dotenv
DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:54322/postgres
```

Inside the container, `127.0.0.1` refers to the server container itself. For a
remote database, use its actual connection string instead. The database must be
running, migrated, and seeded before starting the server; the image does not
initialize it. On Linux, the host database must also accept connections from
the Docker bridge network.

```bash
pnpm run deploy:server
docker compose -f compose.server.yaml logs -f server
# Stop the server container:
docker compose -f compose.server.yaml down
```

The backend health check calls `/`, which is not rate limited; the HTTP server starts after
database recovery and market readiness. The tunnel waits for a healthy backend
before its initial startup. A backend startup failure makes `deploy:server` fail
instead of reporting success just because a container was created.

The API and WebSocket server are exposed on port 3000. Stop any local server
already using that port, or change the host side of `3000:3000` in the Compose
file. Application env files are excluded from the image and injected at runtime.
Recreate the container after changing `.env.docker`:

```bash
pnpm run deploy:server:force
```

This command recreates only the backend without rebuilding the image, waits for
backend health, then ensures the tunnel is running. An unchanged, running tunnel
is kept; a stopped or missing tunnel is started. Code changes still require
`pnpm run deploy:server` to build a new image.

### Frontend on Cloudflare Workers

Configure the public API URL and Reown project ID in the ignored
`apps/web/.env.production`, or supply them through the build environment. Local
`.env.production.local` and exported environment variables take precedence.
The frontend build embeds the `NEXT_PUBLIC_*` values, so publish again after
changing them.

On a new machine, authenticate once, then deploy:

```bash
pnpm --filter web exec wrangler login
pnpm run deploy:web
```

See [Cloudflare deployment](docs/frontend/cloudflare-deployment.md) for CI,
custom domains, and CORS configuration.

### Alchemy

- Target: web on Cloudflare
- Configure provider accounts: `cd packages/infra && pnpm exec alchemy profile edit`
- Dev: pnpm run dev
- Deploy: pnpm run deploy
- Destroy: pnpm run destroy

`alchemy profile edit` stores the selected Axiom, Cloudflare, Neon, PlanetScale, and/or Prisma provider profiles under `~/.alchemy`; no provider-specific setup command is required by this scaffold.

Deploys are staged and default to a personal `dev_<username>` stage. For production, run the deploy with an explicit stage from `packages/infra`:

```bash
cd packages/infra && pnpm exec alchemy deploy --stage production
```

## Project Structure

```
binance-contract-trading-full-stack/
├── apps/
│   ├── web/         # Frontend application (Next.js)
│   ├── native/      # Mobile application (React Native, Expo)
│   └── server/      # Backend API (Hono)
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   └── db/          # Database schema & queries
```

## Available Scripts

- `pnpm run dev`: Start all applications in development mode
- `pnpm run build`: Build all applications
- `pnpm run dev:web`: Start only the web application
- `pnpm run dev:server`: Start only the server
- `pnpm run deploy:server`: Build and start the Docker backend and tunnel, waiting for backend health
- `pnpm run deploy:server:force`: Apply backend env changes without rebuilding, then ensure the tunnel is running
- `pnpm run deploy:web`: Build and publish only the frontend to Cloudflare Workers
- `pnpm run check-types`: Check TypeScript types across all apps
- `pnpm run dev:native`: Start the React Native/Expo development server
- `pnpm run db:push`: Push schema changes to database
- `pnpm run db:generate`: Generate database client/types
- `pnpm run db:migrate`: Run database migrations
- `pnpm run db:studio`: Open database studio UI

