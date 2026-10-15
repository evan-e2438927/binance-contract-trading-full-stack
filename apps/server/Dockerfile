# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /workspace

# Keep the workspace's pnpm lockfile and dependency versions.
RUN npm install --global pnpm@11.8.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/server/package.json ./apps/server/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/engine/package.json ./packages/engine/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN pnpm --filter server... install --frozen-lockfile --ignore-scripts

COPY apps/server ./apps/server
COPY packages/config ./packages/config
COPY packages/db ./packages/db
COPY packages/engine ./packages/engine
COPY packages/shared ./packages/shared
RUN pnpm --filter server exec varlock codegen
RUN pnpm --filter server run build
# Force the built-in deploy command despite the root package's deploy script.
RUN pnpm pm --filter server deploy --prod --legacy --ignore-scripts /out

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps/server/dist ./dist
# Varlock reads the schema at startup; actual values come from the container env.
COPY --from=build --chown=node:node /workspace/apps/server/.env.schema ./.env.schema
COPY --from=build --chown=node:node /workspace/apps/server/package.json ./package.json
# Types are generated during the build; runtime only needs env validation.
RUN sed -i '/^# @generateTsTypes(/d' .env.schema

USER node
EXPOSE 3000
CMD ["node", "dist/index.mjs"]
