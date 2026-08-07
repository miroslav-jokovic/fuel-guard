# FuelGuard driver-dist — internal Android build distribution.
#
# WHY A DOCKERFILE AND NOT NIXPACKS. Nixpacks infers a build from the repository, and for this
# service every inference it makes is wrong. It sees a pnpm monorepo and runs `corepack enable &&
# pnpm install --frozen-lockfile` — a full workspace install, for a service with ZERO dependencies —
# and on 2026-08-07 that failed outright: with the service's root directory pointed at
# apps/driver-dist, nixpacks read that package.json, found no `engines` field, chose Node 18, and
# Node 18's bundled corepack could not verify npm's current registry signing keys:
#
#   Error: Cannot find matching keyid: {"signatures":[...],"keys":[...]}
#
# Six lines of Dockerfile remove the entire class of problem: a pinned runtime, no package manager,
# no workspace install, and a build that takes seconds instead of minutes. The service genuinely has
# no dependencies — it is Node built-ins only — so there is nothing for a builder to resolve.
#
# Build context is the REPOSITORY ROOT (the service's Railway root directory must be empty), because
# the paths below are repo-relative and railway.driver-dist.json lives at the root.
FROM node:22-alpine

WORKDIR /app

# Only the two files this service is. Nothing else in the repository can affect the image.
COPY apps/driver-dist/package.json ./package.json
COPY apps/driver-dist/server.mjs ./server.mjs

ENV NODE_ENV=production
# Railway overrides PORT at runtime; this is the local default and documents the contract.
ENV PORT=8080
EXPOSE 8080

# Runs as root deliberately: the Railway volume mounted at /data is root-owned, and dropping to the
# image's `node` user would leave the service unable to write the releases it exists to store.
CMD ["node", "server.mjs"]
