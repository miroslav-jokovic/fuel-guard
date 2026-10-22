# syntax=docker/dockerfile:1.7
#
# It lives here, not at the repository root, because Railway builds any root `Dockerfile` it finds
# in place of railway.json's NIXPACKS builder: #1716 put it at the root and every Railway deploy of
# af12f59 failed (staging 2026-10-22 18:38Z, on a `--mount` flag Railway refuses), which would have
# failed the production release too. Its ignore file sits beside it as `Dockerfile.dockerignore`, the
# name BuildKit reads for a Dockerfile outside the context root, so Railway sees neither.
#
# The app-tier image for the AWS move (docs/plans/architecture/AWS-MIGRATION-PLAN.md, D-AWS6, AWS5).
# It reproduces railway.json / railway.worker.json / railway.admin.json — same install, same Vite
# build, same `node --import tsx` start — so the code the EC2 servers run is the code Railway runs
# today, and a difference between the two hosts can only be the host.
#
# Two targets:
#   app      — api, worker and web (railway.json + railway.worker.json). Which role a container plays
#              comes from its command and environment, exactly as on Railway (D-RLY2 lanes,
#              RUN_SCHEDULERS_IN_PROCESS), never from a different image.
#   console  — platform console (railway.admin.json): apps/admin built, apps/admin-api started.
#
# Node 22 (.nvmrc), not 24: the 24.10 worker thread drops the tsx loader in production only.
#
# The office SPA inlines its VITE_* values at build time (import.meta.env), and staging and
# production point at different Supabase projects — so `app` is built once PER ENVIRONMENT with build
# arguments, as Railway builds once per environment today. D-AWS6's "same artefact in staging and
# production" therefore holds for the server code but not the SPA bundle; Q-AWS13 in the plan
# records the runtime-config change that would make it hold for both. VITE_* values are public by
# design (they ship to every browser); no secret is ever a build argument.

FROM node:22-bookworm-slim AS source
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /app
COPY . .
# railway's `pnpm install --frozen-lockfile --prod=false`, filtered to what a server runs: the driver
# app (Expo/React Native) is imported by nothing here and roughly doubles the install.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod=false \
      --filter "@silvicom/api..." --filter "@silvicom/web..." \
      --filter "@silvicom/admin..." --filter "@silvicom/admin-api..."

# ---- app: api / worker / web --------------------------------------------------------------------
FROM source AS app
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_API_URL
ARG VITE_APP_ENVIRONMENT
ARG VITE_SENTRY_DSN
ARG VITE_SENTRY_ENVIRONMENT
ARG VITE_SENTRY_TRACES_SAMPLE_RATE
ARG VITE_SUPPORT_EMAIL
RUN test -n "$VITE_SUPABASE_URL" && test -n "$VITE_SUPABASE_ANON_KEY" \
 || { echo "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required build arguments"; exit 1; }
RUN rm -rf apps/web/dist && pnpm --filter ./apps/web exec vite build
ARG GIT_COMMIT_SHA
ARG GIT_BRANCH
# buildInfo.ts reads these when RAILWAY_GIT_* are absent, so /api/version still names the commit.
ENV NODE_ENV=production GIT_COMMIT_SHA=${GIT_COMMIT_SHA} GIT_BRANCH=${GIT_BRANCH}
USER node
EXPOSE 8080
# railway.json's startCommand. The worker runs this image with
# `node --import tsx apps/api/src/worker.ts` (railway.worker.json).
CMD ["node", "--import", "tsx", "apps/api/src/index.ts"]

# ---- console ------------------------------------------------------------------------------------
FROM source AS console
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_ADMIN_API_URL
ARG VITE_CUSTOMER_APP_URL
RUN rm -rf apps/admin/dist && pnpm --filter @silvicom/admin build
ARG GIT_COMMIT_SHA
ARG GIT_BRANCH
ENV NODE_ENV=production GIT_COMMIT_SHA=${GIT_COMMIT_SHA} GIT_BRANCH=${GIT_BRANCH}
USER node
WORKDIR /app/apps/admin-api
# admin-api's own default port; Railway injects PORT, and the server's compose file will too.
EXPOSE 8090
# railway.admin.json starts `pnpm --filter @silvicom/admin-api start` = `tsx src/index.ts` in this
# directory. Calling node with the tsx loader directly does the same without pnpm at run time, which
# as a non-root user would try to download itself through corepack on every start.
CMD ["node", "--import", "tsx", "src/index.ts"]
