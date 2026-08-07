# FuelGuard driver-dist — internal Android build distribution.
#
# WHY A DOCKERFILE AND NOT NIXPACKS. Nixpacks infers a build from the repository, and for this
# service every inference it makes is wrong. It sees a pnpm monorepo and runs `corepack enable &&
# pnpm install --frozen-lockfile` — a full workspace install, for a service with ZERO dependencies —
# and on 2026-08-07 that failed outright: with the service's root directory pointed at
# apps/driver-dist, nixpacks read that package.json, found no `engines` field, chose Node 18, and
# Node 18's bundled corepack could not verify npm's current registry signing keys
# ("Cannot find matching keyid"). This service is Node built-ins only, so there is nothing for a
# builder to resolve — a pinned runtime and two files is the whole truth of it.
#
# WHY THE FIRST STAGE LOOKS OVERBUILT FOR TWO FILES. Railway's "Root Directory" setting prunes the
# build context, and whether it is set changes where these files live relative to the context root.
# On 2026-08-07 that setting was wrong twice in a row, the second time producing an opaque
# `failed to calculate checksum ... "/apps/driver-dist/server.mjs": not found` — a message that says
# nothing about the cause. Locating the files at build time instead of hard-coding one layout makes
# the image build correctly under either setting, and when neither matches it prints the context
# listing and a sentence naming the actual problem. The final stage still contains exactly two files;
# the search stage is discarded.
FROM node:22-alpine AS context

WORKDIR /src
COPY . .

RUN set -eu; \
    mkdir -p /out; \
    if [ -f apps/driver-dist/server.mjs ]; then \
      src=apps/driver-dist; \
    elif [ -f server.mjs ]; then \
      src=.; \
    else \
      echo "ERROR: driver-dist sources are not in this build context." >&2; \
      echo "Expected either apps/driver-dist/server.mjs (Railway Root Directory EMPTY)" >&2; \
      echo "or server.mjs (Railway Root Directory = apps/driver-dist). Context contains:" >&2; \
      ls -la >&2; \
      exit 1; \
    fi; \
    cp "$src/server.mjs" "$src/package.json" /out/; \
    node --check /out/server.mjs

FROM node:22-alpine

WORKDIR /app
COPY --from=context /out/ ./

ENV NODE_ENV=production
# Railway overrides PORT at runtime; this is the local default and documents the contract.
ENV PORT=8080
EXPOSE 8080

# Runs as root deliberately: the Railway volume mounted at /data is root-owned, and dropping to the
# image's `node` user would leave the service unable to write the releases it exists to store.
CMD ["node", "server.mjs"]
