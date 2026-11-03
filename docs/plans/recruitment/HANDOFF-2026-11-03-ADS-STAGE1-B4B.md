# Handoff · 2026-11-03 · Ads agent, Stage 1 from step B4b (the leadgen webhook)

**Paste this whole file into a fresh chat.** It continues `HANDOFF-2026-11-02-ADS-STAGE1-D0.md`. That
handoff's §4 traps, the B2 handoff's §4–§5 (traps, process) and the 11/01 handoff's §1 (owner rulings,
not to be re-asked) **still hold**. This file replaces the D0 handoff's §1 position, §3 steps and §6 first
action. Stage 1 = agents + orchestrator proven against fakes, **no social-network or Higgsfield credentials**.

## 0. Read first, in this order

1. `CLAUDE.md` (root): hard rules, the release train, "No workarounds", the two-merge rule.
2. `ADS-AGENT-BUILD-WORKFLOW.md`: the B4 row (§4), §4R's **Lead intake** row (L2 faults: forged
   signature, duplicate webhook, webhook lost, same person on two platforms, malformed phone, prompt
   injection), and the **progress log at the end** — its entries from "D0" onward are this session.
3. What B4b plugs into (read before writing it):
   - `apps/api/src/modules/ads/leads/backfill.ts` — `platformLeadFromMeta` (Meta lead → `PlatformLead`),
     `readFormLeads`, and why the backfill is a 48 h window. **The webhook must reuse
     `platformLeadFromMeta`, not restate it.**
   - `apps/api/src/queue/handlers/adsLeadsBackfill.ts` — the one place ads meets recruiting
     (`recruitingLeadSink` from `modules/recruiting/index.ts`). The webhook needs the same seam.
   - `apps/api/src/modules/ads/platforms/registry.ts` — `pageGraphForConnection` (leads are read with the
     **Page** token).
   - `apps/api/src/appHttp.ts:129–137` — `rawBody` is captured app-wide; `apps/api/src/routes/webhooks.ts`
     (Samsara) is the existing HMAC-over-raw-body pattern. `lib/secretBox.ts` exports `safeEqual`.
   - `apps/api/src/modules/ads/platforms/simulator/fakeMeta.ts` + `fakeMetaLeads.ts` — the fake; the
     signed `leadgen` webhook is its next family, in its **own file** (file budget).
   - `scripts/ads-readiness.registry.mjs` — Lead intake's L1 pins; B4b's `notBuilt(...)` is the last gap.

## 1. Done this session (all merged to main, on staging)

| Step | PR | Merge | What |
|---|---|---|---|
| D0 | #1954 | `86804ff` | **0553** `recruiting_leads` tables: `hiring_profiles`(+versions), `recruiting_openings`(+versions), `recruiting_leads` (attribution frozen RL013), `recruiting_contacts` + `lead_conversions` (append-only, RETENTION_FORBIDDEN), `lead_match_verdicts`. `purge_applicant` takes a converted lead whole; `lead_conversions` in `DRIVER_REASSIGNMENTS`; `lint:migrations` now reads composite FKs to drivers. `recruiting_ai_outputs` deliberately deferred to D3 |
| gate | #1956 | `211a811` | `check-migration-ordering.mjs` refuses a migration numbered **at or below main's newest** (`supabase db push` refuses it after merge) |
| D1a | #1959 | `a9ec63f` | **0554** functions: `phone_e164` (= `normalisePhone`, parity-tested), `ingest_lead` (once per org/channel/ref), `recruiting_lead_matches` (phone/email only), `convert_lead`, `save_hiring_profile_version`, `save_opening_version`, `recruiting_lead_queue` (one person per row, keyset) |
| D1b | #1961 | `ef33a5f` | `packages/shared/src/recruiting/leads/`: `hiringProfile` (v1 = owner's §3a ruling), `opening` (area IS `adAreaSchema`), `leadContract`, `leadMatch` |
| D1c1 | #1963 | `dbedca5` | `recruitingLeadSink` (throws on a failed store), `/api/recruitment/leads` (queue, manual add, `/:id/convert`); roster's create moved to exported `createDriverRecord` (edge `recruiting -> roster`); `postgrestFixture` fixed (projected before ordering) |
| D1c2 | #1964 | `e0f1328` | `/api/recruitment/hiring-profiles`, `/openings`, `/openings/:id/status` — each save a new version |
| B4a1 | #1966 | `e6006f8` | `modules/ads/leads/backfill.ts` + `fakeMetaLeads.ts`; brief ref `<id>@v<n>` now names its opening (`openingOfBrief`) — it did not before, so every ad lead would have arrived with no opening |
| B4a2 | #1969 | `e23225c` | Scheduler `ads-leads-backfill` (hourly, general lane, off unless `ADS_ENABLED`), job `ads_leads_backfill` (`KIND_CAPS` 1, dedup per connection), handler fails by lead id when anything was not brought in |

- **Main at handoff:** `e23225c`. **Newest migration on main:** `0555_document_reads_mvr_report_profile.sql`
  (another chat's). B4b should need **no migration** (see §3); if it does, the number goes ABOVE main's
  newest by name, never into a gap — the gate now refuses a gap.
- **Scorecard (`pnpm ads:readiness`):** Orchestrator L3, Budget guard L3, Security L1, everything else L0.
  **Lead intake reads L0 honestly:** its L1 pins the sink, backfill, handler and tick tests, and its last
  gap is `B4b leadgen webhook`. When B4b lands with its tests pinned, Lead intake reaches **L1**.
- **The hiring chat** (`../FuelGuard-disp`) held an uncommitted `0552_applicant_outcomes.sql`. It must be
  renumbered above main's newest before its PR (the new gate refuses it otherwise). Not ours to do; say so
  if it comes up.
- Worktree `../FuelGuard-ads-d1` holds this session's branches and may be reused or removed.

## 2. Open questions and blockers (do not route around them)

- **Q-AD23 / Q-AD24:** unchanged, owner has not ruled (B2 handoff §2).
- **The Meta APP SECRET** (owner track, due Mon 11/09). There are **no `META_*` env vars**. So B4b ships
  **fail-closed**: with no `META_APP_SECRET` the POST answers **503** and counts the miss; the hourly
  backfill keeps bringing every lead in. Do not invent a secret, do not accept unsigned bodies "for now".
- **The verify token** for `GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…` is ours to choose,
  but it is a secret too: an env var (`META_WEBHOOK_VERIFY_TOKEN`), absent = the GET answers 503 as well.
  Adding two optional env vars is fine (schema in `apps/api/src/env.ts`); setting them is owner track.
- **Page subscription to `leadgen`** (`POST /{page_id}/subscribed_apps?subscribed_fields=leadgen` with the
  Page token) needs the real app. Build it against FakeMeta, run it from Connect/the connection test, and
  record in the PR that it is unproven until L4.

## 3. Next step: B4b — the leadgen webhook (one PR; split if it passes ~500 lines)

What Meta sends (read the docs and cite them in the header, as `fakeMetaLeads.ts` does — do not trust this
summary over the page): `X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the RAW body with the app secret>`;
body `{ object: "page", entry: [{ id: <page id>, time, changes: [{ field: "leadgen", value: { leadgen_id,
page_id, form_id, ad_id, adgroup_id, created_time } }] }] }`. **The webhook carries ids, not answers** — the
lead itself is read by id (`GET /{leadgen_id}`) with the Page token.

Shape proposed (confirm against the code before building):
1. **Route** `apps/api/src/modules/ads/routes/metaWebhook.ts`, mounted public (no auth) like Samsara's:
   - `GET` verify: mode `subscribe` + matching verify token (constant-time) → echo `hub.challenge`; wrong
     token → 403; no token configured → 503.
   - `POST`: no `META_APP_SECRET` → 503 + counter; signature missing/malformed/wrong → **401 + counter**,
     compared with `safeEqual` over the **raw** bytes (never `JSON.stringify(req.body)`); valid → enqueue
     and answer **200 fast**. Meta retries on non-2xx and expects a quick answer, so the request does not
     call Meta or the sink.
2. **Job** `ads_lead_fetch` (new `JobKind`, `KIND_CAPS` 1, `dedup_key` = `ads_lead_fetch:<leadgen_id>` —
   a duplicate webhook is then the queue's own "already on it"). Handler in `queue/handlers/` (the seam,
   like `adsLeadsBackfill.ts`): find OUR campaign by `platform_refs.meta_form_id` (org-scoped; a form we
   do not own is acknowledged and dropped, logged by id), open its connection's Page graph, `GET
   /{leadgen_id}?fields=id,created_time,field_data,ad_id,campaign_id`, `platformLeadFromMeta`, sink.
   Throws on failure so it retries; the backfill is still the net.
3. **FakeMeta:** a `fakeMetaWebhooks.ts` that signs a `leadgen` delivery with a test app secret (and can
   send it twice, forged, or not at all), plus `GET /{lead_id}` in `fakeMetaLeads.ts`, Page token only.
4. **Subscribe:** `subscribed_apps` for `leadgen` — on FakeMeta; called from the connection test (B1b's
   `connectionTest.ts`) and reported there.
5. **Readiness:** replace Lead intake's `notBuilt("B4b …")` with the pinned tests → **L1**. Consider pinning
   the §4R L2 faults that are now testable (forged, duplicate, lost → backfill brings it, two platforms,
   malformed phone, injection) under L2 if they all exist; otherwise leave L2 as `later`.
6. **Docs:** progress-log entry; `docs/WORKER-DEPLOYMENT.md` (the new kind); `G-sec` in the workflow asks a
   `/security-review` on B4 — run it on the PR's diff and record the result.

Tests that must exist (each shown to fail by mutation before the PR, as every step this session):
a forged body → 401 and the counter moves; a valid body re-serialised differently still verifies (proves
raw bytes); no secret → 503 and nothing enqueued; duplicate delivery → one job, one lead; a form we do not
own → 200, nothing stored; the fetched lead reaches the sink with its campaign and brief; a lead fetch that
fails → job fails (and the backfill brings it next hour); GET verify right / wrong / unconfigured.

**Then (unchanged order):** B5 monitor, C1–C5 (+ `lint:agent-fixtures`, `pnpm ads:eval`), B2c, F1, D2, E1–E5.
**Honest calendar:** Stage 1 is still C1–C5, B5, B2c, F1, D2, E1–E5 and the eval tooling away; then Stage 2
(credentials, L4). The first real ad is no earlier than the day after L4. Say so again if asked.

## 4. Traps hit this session (add to the earlier lists)

- **Never skip a migration number for a parallel chat.** `supabase db push` refuses one below the last
  applied; the gate (#1956) now refuses it on the PR.
- **`apps/api` tests may not cast to `Env`** (`src/testing/envCasts.test.ts`): use `testEnv()`. The gates
  job does not catch it — **run the full api suite** (`cd apps/api && CI=true npx vitest run`, ~5 min) before
  pushing; B4a1's CI went red on exactly this.
- **`lint:table-writers`**: a new file writing a table goes in `scripts/table-writers.json` in the same PR.
  **`lint:boundaries`**: a new module edge goes in `check-feature-boundaries.mjs` with its reason.
  **`lint:record-ids`**: use `recordId()` / `isRecordId()`, never `z.uuid()` or a UUID regex.
- **`check-table-producers`**: a waiver goes stale the moment a function writes the table — retire it.
- **`postgrestFixture` now orders before it projects** (fixed in #1963). Older tests that ordered by an
  unselected column were silently unordered; if one turns red, that is why.
- **A function's reader merges after the function reaches staging** (`lint:migration-ordering` sees columns,
  not functions). Check with `pnpm verify:live staging` → schema version.
- **`git stash` is shared across all worktrees** of this repo; check `git stash list` before and after.
- **The post-checkout hook rebuilds graphify** (~1–2 min) — a `git checkout` that "hangs" is that.
- **Known api flake:** `efsCardControl.test.ts` timed out once in CI (16 s vs 5 s), passed locally and on
  re-run (`gh run rerun <id> --failed`). Check the failing file is not yours before re-running.
- **Meta field names:** our form asks `phone`, Meta's default is `phone_number`; `leadContract` reads both.
  A custom answer may come back as the option key or the shown label (EN/ES); `catalogueAnswer` reads all.

## 5. Owner track (unchanged, due Mon 11/09)

Meta setup ("Meta ready", never a token in chat) **including the app secret and a webhook verify token**,
Higgsfield API key, TikTok developer app, X contact, brand kit + photos, **the first opening** (it can now be
saved: `POST /api/recruitment/openings`), spending values, presets P1–P5, counsel (G12 / Q-AD8), rulings on
Q-AD23 / Q-AD24, and approval of the next release (it carries everything from A5 through B4a).

## 6. First action in the new chat

1. Read §0.
2. Confirm no ads PR is open (`gh pr list --search "Ads agent in:title"`).
3. Confirm main's HEAD and the newest migration **by name**.
4. Run `pnpm ads:readiness`; it must match §1 (Lead intake L0, last gap B4b).
5. Read Meta's webhook and lead-retrieval pages; confirm §3's payload and signature against them, and say
   in one short message what differs. Then build B4b.
