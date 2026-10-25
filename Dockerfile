# One image for every service. Each service in docker-compose.yml runs a
# different command from it. This keeps builds simple and guarantees that all
# services run the exact same code and dependency versions.

FROM node:24-alpine AS base
RUN npm install -g pnpm@12.15.0 && mkdir /app && chown node:node /app
WORKDIR /app
# Everything from here on runs as the unprivileged `node` user, and the app
# files belong to it, so a compromised service cannot modify the system.
USER node

# Download dependencies using only the lockfile, so this layer is cached and
# re-used until pnpm-lock.yaml changes.
FROM base AS deps
COPY --chown=node:node pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch

FROM deps AS build
COPY --chown=node:node . .
RUN pnpm install --offline --frozen-lockfile
# The web app is the only part that needs a build step. Node runs the
# TypeScript of every other service directly.
RUN pnpm --filter @reb/web build

FROM build AS runtime
ENV NODE_ENV=production
# Created here, owned by `node`, so the `media` volume mounted on it is
# writable by the app.
RUN mkdir -p /app/data/media
