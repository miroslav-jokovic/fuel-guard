---
paths:
  - "apps/web/e2e-apply/**"
  - "apps/web/e2e/**"
  - "apps/web/tutorials/**"
  - "apps/web/playwright*.ts"
  - ".github/workflows/smoke.yml"
---

# Browser tests (moved from the root CLAUDE.md)

- **Browser tests run in `bundle`**: `pnpm --filter @silvicom/web e2e:apply` runs
  `apps/web/e2e-apply/` — the applicant's page, built, in Chromium, against a stubbed API
  (`e2e-apply/stubApi.ts`, raw JSON). Beside them, `tutorials --check` runs every video tutorial's
  steps camera-less (`apps/web/tutorials/README.md`). Those two are the ONLY Playwright runs in CI:
  `apps/web/e2e/` is `smoke.yml`'s, against production after a deploy, so a stubbed spec must never
  go there. Locally: build `dist` first (CI's placeholder `VITE_SUPABASE_*` values), then run `e2e:apply`.
