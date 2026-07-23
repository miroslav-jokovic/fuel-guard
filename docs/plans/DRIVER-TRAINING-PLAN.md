# FuelGuard — Driver Safety Training (Micro-LMS) — Build Plan

> **Status: PLANNING COMPLETE — ready for implementation.**
> This document is self-contained: a fresh chat (or a fresh developer) can implement the feature
> from this file alone. Read top-to-bottom once, then work phase by phase (§12).
> Conventions follow `docs/01-ARCHITECTURE.md`, `docs/02-DATA-MODEL.md`, `docs/MIGRATION-DISCIPLINE.md`.

**Feature name:** Training (internal code name `training`) · **Section:** Safety
**Created:** 2026-07-23 · **Owner:** Miki

---

## 0. Progress tracker

Update this table as phases land. A phase is DONE only when its acceptance criteria (§12) pass.

| Phase | Scope | Status |
|-------|-------|--------|
| 0 | Groundwork: bucket, env, shared types, provider abstraction | ☐ not started |
| 1 | Migrations 0079–0081: schema + RLS + audit | ☐ not started |
| 2 | Admin authoring UI + API (courses, segments, questions, publish) | ☐ not started |
| 3 | Learner player + rules engine (in-app flow) | ☐ not started |
| 4 | Email one-time-link flow (Resend) | ☐ not started |
| 5 | Compliance records, certificates, reporting dashboard | ☐ not started |
| 6 | Hardening: cost controls, rate limits, tests, docs | ☐ not started |

---

## 1. Decisions (LOCKED — confirmed with Miki 2026-07-23)

| # | Decision | Detail |
|---|----------|--------|
| D1 | **Video storage: Supabase Storage (Phase 1) behind a provider abstraction** | Private bucket `training-videos`, short-TTL signed URLs minted by the API. A `VideoDeliveryProvider` interface (§6.4) isolates the choice so we can swap to Bunny Stream (~$1/mo) or Cloudflare Stream later **without touching schema, API routes, or UI**. See cost guardrails §6.5 — at 200+ drivers Supabase egress is the #1 cost risk. **Update 2026-07-23: org is on Supabase Pro (250 GB egress incl.), and uploads are auto-compressed server-side (§6.3) to keep per-view egress ~3–6× lower.** |
| D2 | **Scale target: 200+ drivers, multi-org ready** | Everything is `org_id`-scoped with per-org quotas from day one (matches existing multitenancy). |
| D3 | **Authoring: full admin UI builder** | Upload video segments, write questions, set rules, publish versions — all in-app under Safety. No JSON files, no dev involvement for content changes. |
| D4 | **Compliance: full audit-proof records** | Immutable completion records (who/what/when/score/duration/version), append-only event log, driver attestation, PDF certificates, ≥3-year retention (49 CFR 380.725 as the model). Training records are **never hard-deleted**. |
| D5 | **No SCORM/xAPI** | We control both content and player; our own schema is simpler and more granular. If a customer ever needs an export, emit xAPI-shaped JSON from `training_events` — do not re-architect. |
| D6 | **Assignable beyond drivers** | Assignments target either a `drivers` row (may have no login) or any org member (`memberships.user_id`) — so dispatchers, fleet managers, etc. can be assigned training too. |
| D7 | **Two delivery channels** | (a) In-app under Safety / "My Training"; (b) one-time email link via Resend for drivers without logins. The future mobile app reuses channel (b)'s token API unchanged (§9). |

### 1.1 Business rules (from Miki, made precise)

These are the canonical rule definitions. The engine (§5) implements exactly these; per-course
config can override the numeric defaults but not the shape of the rules.

- **R1 — Sequential gating.** A course version is an ordered list of segments (video + quiz).
  Segment N+1 is locked until segment N is complete (video watched ≥ `watch_threshold_pct`
  (default **90%**) **and** quiz passed).
- **R2 — Fail ⇒ rewatch.** A quiz attempt with score < `pass_pct` (default **80%**) fails.
  After a failed attempt the segment's video state resets to `must_rewatch`; the quiz cannot be
  re-taken until the video is watched to threshold again.
- **R3 — 3 strikes ⇒ full reset.** After `max_segment_attempts` (default **3**) failed quiz
  attempts on any single segment, the whole course attempt is marked `reset`; a new attempt is
  created with all progress zeroed (driver rewatches everything from segment 1). The failed
  attempt row is kept forever (audit trail).
- **R4 — Partial re-training.** An assignment can scope to a subset of segments
  (`scope = {"segments": ["seg_a","seg_c"]}`) so re-training doesn't require redoing the full
  course. Completion/certificate then references that scope.
- **R5 — Question pools + shuffle.** Each segment quiz can draw `draw_count` questions from a
  larger pool; question order and choice order are shuffled per attempt. The exact served set +
  order is persisted on the quiz attempt row so the audit can reconstruct what was shown.
- **R6 — Server-side grading only.** Correct answers never reach any client payload. The learner
  API serves a projection without `is_correct`. Grading happens in Express in a transaction.
- **R7 — Honest-effort anti-cheat (proportionate, no DRM).** Watched progress is tracked as
  merged watched-ranges (not just max position); a segment can't complete in less wall-clock time
  than `0.9 × video_duration`; quiz submissions faster than 2 s/question are flagged in
  `training_events` (not blocked). Forward-seek is disabled in the player UI for first watch.
- **R8 — Anti-copy (added 2026-07-23).** Links are strictly single-use (§7.2); playback URLs are
  short-lived and per-entitlement; the player renders a **moving semi-transparent watermark**
  (viewer name/email + date, repositions every ~20 s) over the video and sets
  `controlsList="nodownload" disablePictureInPicture`. Screen recording can't be technically
  prevented — the watermark makes any leaked copy identify its source, which is the practical
  deterrent every major training platform uses.

---

## 2. Current-app facts this plan builds on (verified 2026-07-23)

Do not re-derive these; they were read from the codebase.

- **Stack:** Vue 3 + Vite SPA (`apps/web`), Express API (`apps/api`), shared Zod/types in
  `packages/shared`, Supabase Postgres + Auth + Storage, Railway (2 services: web+api via
  `railway.json`, admin via `railway.admin.json`), pnpm workspaces.
- **Roles enum** `user_role`: `admin, fleet_manager, driver, auditor, dispatcher, safety_manager`
  (migrations `0077`/`0078`). Section capability matrix lives in `packages/shared/src/auth.ts`
  (`SECTION_ACCESS`); sections: `fuel, dispatch, safety, fleet, admin`. Safety is managed by
  `admin, fleet_manager, safety_manager` — **training management uses exactly this set** via the
  existing `rolesThatManage("safety")` helper.
- **API auth middleware:** `requireAuth, requireRole, requireOrg` from
  `apps/api/src/middleware/auth.ts`. Service-role client in `apps/api/src/lib/supabaseAdmin.ts`.
  Rule (audit B5): org_id always derived from the verified JWT, never the request body; every
  `:id` ownership-checked against that org before service-role writes.
- **RLS helpers:** `auth_org_id()`, `auth_role()` (SQL), used by every policy; JWT claims
  injected by the Custom Access Token hook (migration 0006).
- **Email:** provider-agnostic `sendEmail(env, {to, subject, html, text})` in
  `apps/api/src/lib/mailer.ts` (Resend or Brevo via `MAIL_PROVIDER`, `MAIL_FROM`).
- **Background jobs ledger:** `jobs` table (migration 0027) — one active run per (org, kind),
  service-role writes only. Reuse for transcode/quota-recompute jobs if needed.
- **Invites pattern:** public page `/accept-invite` + token flow exists — BUT invite tokens are
  stored **in plaintext** (`routes/invites.ts` uses `randomUUID()+randomUUID()`); training links
  MUST NOT copy this — we hash tokens at rest (§7.2). (Consider retrofitting invites later.)
- **Migrations:** last is `0078_role_department_rls.sql` → training starts at **0079**.
  Follow `docs/MIGRATION-DISCIPLINE.md` (enum additions isolated, policies compare text, etc.).
- **Lint gates:** `pnpm lint`, `lint:filesize` (keep files small — use feature folders),
  `lint:boundaries` (respect feature-module boundaries), `pnpm typecheck`, `pnpm test` (vitest).
- **Web structure:** pages in `apps/web/src/pages/*.vue`, feature modules in
  `apps/web/src/features/<name>/`, routes in `apps/web/src/router/index.ts`, sidebar in
  `apps/web/src/lib/nav.ts`, public (unauthenticated) route pattern exists (`/accept-invite`).
- **Drivers may have no login:** `drivers.user_id` is nullable — this is why the email-link
  channel exists.

---

## 3. Architecture overview

```
                        ┌───────────────────────────── Railway ─────────────────────────────┐
   Safety manager ──►   │  web (Vue SPA)                        api (Express)               │
   (authoring, assign)  │   /safety/training/*  ──────────────►  /api/training/admin/*      │
                        │                                        (requireRole safety-manage)│
   Driver w/ login ──►  │   /my-training/*      ──────────────►  /api/training/learner/*    │
                        │                                        (requireAuth, self-scoped) │
   Driver via email ─►  │   /t/:token (public)  ──POST exchange► /api/training/links/*      │
   (one-time link)      │   then same player UI ──────────────►  /api/training/learner/*    │
                        │                                        (scoped training JWT)      │
                        └──────────────────────────────┬────────────────────────────────────┘
                                                       │ service role
                        ┌──────────────────────────────▼────────────────────────────────────┐
                        │ Supabase: Postgres (training_* tables, RLS) ·                     │
                        │ Storage: `training-videos` (private), `training-certs` (private)  │
                        └───────────────────────────────────────────────────────────────────┘
```

Key principles:

1. **One player, three entry points.** The learner player + rules engine is a single feature
   module; in-app users, email-link users, and (later) the mobile app all hit the same
   `/api/training/learner/*` endpoints, differing only in how their token was obtained.
2. **All training writes go through Express** (service role). Web reads admin lists directly from
   Supabase where convenient (RLS-protected), but attempts/progress/grading are API-only — email
   -link drivers have no Supabase session, and grading must be server-side anyway (R6).
3. **Published content is immutable.** Authoring edits drafts; publishing snapshots the entire
   course (segments, videos refs, questions, rules) into `training_course_versions.content`.
   Attempts pin to a version forever (D4 depends on this).
4. **Videos are private.** No public URLs. Playback uses signed URLs with a short TTL minted per
   request by the API, metered per org (§6.5).

---

## 4. Data model — migrations 0079–0081

Three migrations, following house discipline: `0079_training_core.sql` (enums + tables + indexes),
`0080_training_rls.sql` (policies), `0081_training_audit.sql` (append-only event log + guards).
All tables have `org_id`, `created_at`, `updated_at` (updated_at via the existing trigger pattern).

### 4.1 Enums (0079)

```sql
create type training_course_status   as enum ('draft', 'published', 'archived');
create type training_assignment_status as enum ('pending', 'sent', 'in_progress', 'completed', 'expired', 'revoked');
create type training_attempt_status  as enum ('active', 'passed', 'failed', 'reset', 'expired', 'revoked');
create type training_segment_state   as enum ('locked', 'watching', 'must_rewatch', 'ready_for_quiz', 'passed');
create type training_subject_type    as enum ('driver', 'member');
```

### 4.2 Authoring tables (mutable DRAFT side)

```sql
-- The course container. current_published_version_id is denormalized for fast lookup.
create table training_courses (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  title        text not null,
  description  text,
  status       training_course_status not null default 'draft',
  -- rule config (draft; snapshotted into the version on publish). Defaults per §1.1.
  rules        jsonb not null default '{"pass_pct":80,"watch_threshold_pct":90,"max_segment_attempts":3,"shuffle_questions":true,"shuffle_choices":true}',
  current_published_version_id uuid,          -- FK added after training_course_versions exists
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Ordered segments of the DRAFT. segment_key is a stable slug (survives reorder) used by
-- progress rows and assignment scopes; generated once (e.g. 'seg_' || 8 hex chars).
create table training_segments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  course_id    uuid not null references training_courses(id) on delete cascade,
  segment_key  text not null,
  sort_order   int  not null,
  title        text not null,
  video_id     uuid,                          -- FK → training_videos(id), added after that table exists; nullable while drafting
  quiz_draw_count int,                        -- null = serve all questions
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (course_id, segment_key)
);

create table training_questions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  segment_id   uuid not null references training_segments(id) on delete cascade,
  sort_order   int  not null,
  prompt       text not null,
  -- choices: [{"key":"a","text":"..."}...] ; correct_keys: ["a"] (single- or multi-select)
  choices      jsonb not null,
  correct_keys jsonb not null,
  select_mode  text not null default 'single',  -- 'single' (radios) | 'multi' (checkboxes) — in the learner projection too
  explanation  text,                          -- shown AFTER the attempt is graded (optional)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Video asset registry (bucket objects are never referenced by raw path anywhere else).
create table training_videos (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  storage_path text not null,                 -- HD rendition '<org_id>/<video_id>/play_hd.mp4'
  low_path     text,                          -- data-saver rendition '<org_id>/<video_id>/play_low.mp4'
  raw_path     text,                          -- '<org_id>/<video_id>/raw.mp4' — deleted after successful transcode
  filename     text not null,                 -- original upload filename (display only)
  raw_bytes    bigint,                        -- as uploaded
  bytes        bigint,                        -- HD size; null until status='ready'
  low_bytes    bigint,                        -- data-saver size
  captions_path text,                         -- optional WebVTT '<org_id>/<video_id>/captions.vtt' (§12.5)
  duration_s   numeric(8,2),                  -- probed SERVER-side by ffprobe during transcode (§6.3)
  status       text not null default 'uploading',  -- uploading | queued | transcoding | ready | failed
  transcode_error text,
  uploaded_by  uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
```

### 4.3 Published snapshot (IMMUTABLE side)

```sql
create table training_course_versions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  course_id     uuid not null references training_courses(id) on delete cascade,
  version_number int not null,
  published_at  timestamptz not null default now(),
  published_by  uuid references auth.users(id),
  -- Full frozen course: {title, rules, segments:[{segment_key, title,
  --   video:{video_id, duration_s, has_captions}, questions:[{qid, prompt, choices,
  --   correct_keys, select_mode, explanation}], quiz_draw_count}]}
  content       jsonb not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (course_id, version_number)
);
alter table training_courses
  add constraint fk_current_version foreign key (current_published_version_id)
  references training_course_versions(id);
```

**Publish algorithm (service, single transaction):** validate draft (every segment has a `ready`
video with duration + ≥1 question; rules valid per Zod schema). Video rows/objects referenced by
ANY published version are permanent: the video-delete path refuses when the `video_id` appears
in any `training_course_versions.content` (checked in the service — JSONB refs can't carry FKs) → build `content` JSONB → insert
version with `version_number = max+1` → set course `status='published'`,
`current_published_version_id` → write `course_published` event. **No UPDATE path exists for
`content`** — typo fixes are a new version. In-flight attempts keep their pinned version; new
assignments resolve to the latest at start (§5.2).

**Editing after publish (explicit semantics):** the draft tables (`training_segments`,
`training_questions`, course `rules`/title) remain the ALWAYS-editable working copy — publishing
snapshots them, it does not freeze them. A `published` course with draft edits newer than
`published_at` shows an "unpublished changes" indicator in the builder; publishing again creates
version N+1. Course `status` lifecycle: `draft` (never published) → `published` (has a current
version; drafts may differ) → `archived` (hidden from new assignments). "Draft only" guards in
§8.1 mean "edits touch draft tables and never any published version" — NOT "no edits after
publish".

### 4.4 Assignment & delivery tables

```sql
create table training_assignments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  course_id     uuid not null references training_courses(id) on delete cascade,
  subject_type  training_subject_type not null,
  driver_id     uuid references drivers(id),        -- when subject_type='driver'
  user_id       uuid references auth.users(id),     -- when subject_type='member'
  scope         jsonb not null default '{"segments":"all"}',   -- or {"segments":["seg_x","seg_y"]} (R4)
  channel       text not null default 'in_app',                -- 'in_app' | 'email'
  status        training_assignment_status not null default 'pending',
  due_at        timestamptz,
  assigned_by   uuid not null references auth.users(id),
  email_to      text,                               -- resolved recipient for the email channel
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((subject_type = 'driver' and driver_id is not null and user_id is null)
      or (subject_type = 'member' and user_id  is not null and driver_id is null))
);
-- One live assignment per (course, subject): partial unique index.
create unique index idx_training_assign_active_driver on training_assignments (course_id, driver_id)
  where driver_id is not null and status in ('pending','sent','in_progress');
create unique index idx_training_assign_active_member on training_assignments (course_id, user_id)
  where user_id is not null and status in ('pending','sent','in_progress');

-- One-time email links. RAW token is emailed and NEVER stored; only sha256 hex lands here.
-- STRICTLY SINGLE-USE: used_at is set atomically by the one successful exchange (§7.2);
-- any later exchange attempt → 410. Continuity comes from training_device_sessions, not reuse.
create table training_links (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  assignment_id uuid not null references training_assignments(id) on delete cascade,
  token_hash    text not null unique,               -- sha256 hex of 32 random bytes (base64url in email)
  expires_at    timestamptz not null,               -- now() + TRAINING_LINK_TTL_DAYS (default 14)
  revoked_at    timestamptz,
  used_at       timestamptz,                        -- single-use consumption marker
  used_ip       text,
  used_ua       text,
  created_by    uuid references auth.users(id),     -- null when self-service re-issued (§7.2 step 5)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- Issuing a new link revokes prior UNUSED links for the assignment (service does this atomically).

-- Device sessions: what a successful link exchange creates. Lets the driver stop and resume for
-- days on the SAME device while the emailed link stays dead after first use. Refresh tokens are
-- 256-bit random, stored hashed, and ROTATE on every refresh; replay of a rotated token revokes
-- the whole session (standard refresh-token-reuse detection).
create table training_device_sessions (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  assignment_id      uuid not null references training_assignments(id) on delete cascade,
  link_id            uuid not null references training_links(id),
  refresh_token_hash text not null unique,          -- current (rotated) token
  prev_token_hash    text,                          -- immediately-previous token, honored ≤60 s post-rotation
                                                    -- (multi-tab/retry grace — §7.2 step 4); older ⇒ reuse ⇒ revoke
  expires_at         timestamptz not null,          -- SLIDING: each successful refresh re-extends to now() + TRAINING_REFRESH_TTL_DAYS
  revoked_at         timestamptz,
  last_seen_at       timestamptz not null default now(),
  last_ip            text,
  last_ua            text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
-- One ACTIVE device session per assignment: a new link exchange revokes older sessions —
-- the link can't multiply into parallel viewers.
create unique index idx_training_session_active on training_device_sessions (assignment_id)
  where revoked_at is null;
```

### 4.5 Attempt & progress tables (compliance core — never hard-deleted)

```sql
create table training_attempts (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  assignment_id     uuid not null references training_assignments(id) on delete cascade,
  course_version_id uuid not null references training_course_versions(id),   -- PINNED forever
  attempt_no        int not null default 1,            -- bumps on R3 full reset
  status            training_attempt_status not null default 'active',
  score_pct         numeric(5,2),                      -- final course score (mean of segment quiz scores)
  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  total_active_seconds int not null default 0,         -- accumulated engaged time (heartbeats)
  attested_at       timestamptz,                       -- §10 attestation
  attest_name       text,
  attest_ip         text,
  attest_ua         text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (assignment_id, attempt_no)
);
-- Exactly one ACTIVE attempt per assignment.
create unique index idx_training_attempt_active on training_attempts (assignment_id) where status = 'active';

create table training_segment_progress (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  attempt_id     uuid not null references training_attempts(id) on delete cascade,
  segment_key    text not null,
  state          training_segment_state not null default 'locked',
  watched_ranges jsonb not null default '[]',          -- merged [[start_s,end_s],...] — server-merged
  watched_pct    numeric(5,2) not null default 0,
  watch_seconds  int not null default 0,               -- wall-clock accumulated (R7 timing check)
  resume_position_s numeric(8,2) not null default 0,   -- last playback position — resume point (§6.6)
  quiz_attempts_used int not null default 0,
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (attempt_id, segment_key)
);

create table training_quiz_attempts (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  attempt_id     uuid not null references training_attempts(id) on delete cascade,
  segment_key    text not null,
  attempt_no     int not null,
  served         jsonb not null,      -- [{qid, choice_order:["c","a","b"]},...] exact set+order shown (R5)
  answers        jsonb,               -- [{qid, selected:["a"]},...] as submitted
  score_pct      numeric(5,2),
  passed         boolean,
  started_at     timestamptz not null default now(),
  submitted_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (attempt_id, segment_key, attempt_no)         -- transaction-safe attempt counting (R3)
);

create table training_certificates (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  attempt_id   uuid not null unique references training_attempts(id),
  cert_number  text not null unique,                   -- 'FG-TRN-' || year || '-' || zero-padded seq
  pdf_path     text not null,                          -- bucket training-certs
  issued_at    timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Egress metering for cost control (§6.5). At most ONE counted row per
-- (attempt_id, video_id, rendition) per 24 h — silent re-mints (URL expiry §12.5), stall
-- downswitch re-issues, and prefetch repeats do NOT double-count (the mint endpoint checks for
-- an existing row in the window before inserting). Prefetch (§6.6.4) fetches the full file, so
-- bytes_est per counted row is treated as ≈ REAL egress, not an upper bound.
create table training_delivery_log (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  video_id    uuid not null references training_videos(id),
  attempt_id  uuid,
  rendition   text not null default 'hd',              -- 'hd' | 'low' | 'captions'
  bytes_est   bigint not null,
  created_at  timestamptz not null default now()
);
create index idx_training_delivery_org_month on training_delivery_log (org_id, created_at);
create index idx_training_delivery_dedupe on training_delivery_log (attempt_id, video_id, rendition, created_at);

-- Admin-granted temporary egress raises (the "override" §6.5 mentions — durable, not env edits).
create table training_egress_overrides (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  month       date not null,                           -- first of month
  extra_gb    int  not null,
  granted_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now(),
  unique (org_id, month)
);
```

### 4.6 Append-only audit log (0081)

```sql
create table training_events (
  id          bigint generated always as identity primary key,
  org_id      uuid not null,
  actor_kind  text not null,        -- 'user' | 'link' | 'system'
  actor_id    text,                 -- user_id, link_id, or null
  action      text not null,        -- course_published | assignment_created | link_issued | link_exchanged
                                    -- | link_denied | video_url_minted | heartbeat_flag | quiz_started
                                    -- | quiz_submitted | segment_completed | attempt_reset | attempt_passed
                                    -- | attested | certificate_issued | assignment_revoked | ...
  entity      text not null,        -- 'course:<id>' | 'assignment:<id>' | 'attempt:<id>' | ...
  payload     jsonb not null default '{}',
  ip          text,
  user_agent  text,
  created_at  timestamptz not null default now()
);
-- Immutability: no UPDATE/DELETE/TRUNCATE for anyone, including via PostgREST.
-- TRUNCATE matters: Supabase's default GRANT ALL gives service_role TRUNCATE, and row-level
-- triggers do NOT fire on TRUNCATE — without these two lines the audit log could be wiped in
-- one statement.
revoke update, delete, truncate on training_events from anon, authenticated, service_role;
create or replace function training_events_immutable() returns trigger language plpgsql as
$$ begin raise exception 'training_events is append-only'; end $$;
create trigger trg_training_events_immutable
  before update or delete on training_events
  for each row execute function training_events_immutable();
create trigger trg_training_events_no_truncate
  before truncate on training_events
  for each statement execute function training_events_immutable();

-- The other never-delete compliance tables get DELETE + TRUNCATE revoked too (UPDATE stays,
-- service-role-only, since attempts/progress mutate legitimately):
revoke delete, truncate on training_attempts, training_quiz_attempts, training_certificates,
  training_course_versions from anon, authenticated, service_role;
```
> Note: `service_role` bypasses RLS but NOT privilege revokes/triggers — with TRUNCATE covered
> above, the log is tamper-evident even against app bugs. Corrections are compensating events,
> never edits.

### 4.7 RLS (0080) — mirrors the section matrix, like 0078

Pattern per table (policies compare `auth_role()` as text, matching house style):

- **SELECT** on all `training_*` tables: `org_id = auth_org_id()` **and** role can view Safety —
  per `SECTION_ACCESS` that is `('admin','fleet_manager','safety_manager','auditor')`
  (`dispatcher` and `driver` have safety: none).
  Additional self-access policy on `training_assignments`, `training_attempts`,
  `training_segment_progress`, `training_quiz_attempts`, `training_certificates`:
  a logged-in user may select rows where `user_id = auth.uid()` or the row's assignment's
  `driver_id` maps to a driver row with `user_id = auth.uid()` (drives the "My Training" page).
- **INSERT/UPDATE** on authoring tables (`training_courses`, `training_segments`,
  `training_questions`): `org_id = auth_org_id() and auth_role() in
  ('admin','fleet_manager','safety_manager')` — allows direct-path authoring CRUD from the SPA.
  **`training_videos` is NOT client-writable** (SELECT-only for safety-manage roles): its
  `status` transitions drive the transcode pipeline and its `storage_path`/`raw_path` feed
  signed-URL minting and ffmpeg — a client-writable path would let a tenant point rows at
  another org's objects (cross-tenant exfiltration) or skip transcoding by flipping `status`.
  All video writes go through the §8.1 endpoints; the mint + transcode code additionally
  asserts every path starts with the row's own `org_id/` (defense in depth).
- **All other writes** (versions, assignments, links, attempts, progress, quiz attempts,
  certificates, delivery log, events): **no policy — service-role only** through Express.
  Publishing, grading, and progress are privileged operations (R6) and email-link drivers have no
  Supabase session anyway.
- `training_links.token_hash`: never selectable by clients — add a column-level trick is not
  available in RLS; instead links get **no SELECT policy at all**; admin UI reads link metadata
  through an API endpoint that omits the hash.

### 4.8 Storage buckets

| Bucket | Access | Contents | Limits |
|--------|--------|----------|--------|
| `training-videos` | private; upload via signed **upload** URL minted by API; playback via signed **download** URL minted by API | `<org_id>/<video_id>/raw.mp4` · `play_hd.mp4` · `play_low.mp4` · `captions.vtt` | Bucket-level `file_size_limit = TRAINING_MAX_UPLOAD_MB` and `allowed_mime_types = video/mp4, video/webm, text/vtt` — set ON THE BUCKET (client-side checks are advisory only; the browser talks straight to Storage). Also raise the project's **Global file size limit** (defaults to 50 MB even on Pro) to ≥ `TRAINING_MAX_UPLOAD_MB` in Storage settings. |
| `training-certs` | private; download via signed URL minted by API | `<org_id>/<cert_number>.pdf` | small |

No storage RLS policies grant client access to these buckets — all object access flows through
API-minted signed URLs (org-checked first). Free tier caps files at 50 MB — compression keeps us
under it, but the Pro plan removes the risk (§6.5).

---

## 5. Rules engine — precise specification

Lives in `apps/api/src/services/training/engine.ts` (+ `engine.test.ts`). Pure functions over
typed state; all mutations happen in route handlers via transactions. The engine is the ONLY
place rule logic exists — UI merely renders the state it returns.

### 5.1 Segment state machine (per `training_segment_progress.state`)

```
              attempt started               watch gate met (E3)
   locked ───────────────────────► watching ───────────────────────► ready_for_quiz
     ▲   (first segment in scope,      ▲                                  │
     │    or previous segment passed)  │ first rewatch heartbeat          │ quiz submit → grade
     │                                 │                                  ▼
     │                            must_rewatch ◄── fail (< pass_pct), attempts_used < max   [R2]
     │                                                    │
  (all progress rows recreated)        fail (< pass_pct), attempts_used == max ──► ATTEMPT RESET [R3]
     │
     └────────────────────────────  passed ◄── score ≥ pass_pct
```

Persisted states are exactly the enum: `locked · watching · must_rewatch · ready_for_quiz ·
passed`. A failed quiz lands the segment in `must_rewatch`; the first accepted rewatch heartbeat
moves it to `watching`. Heartbeats are accepted in `watching` and `must_rewatch` only.

### 5.2 Engine invariants (implement as guards; violating requests → 409 with a reason code)

| # | Invariant |
|---|-----------|
| E1 | Quiz can start only when segment state = `ready_for_quiz` and attempt status = `active`. `quiz/start` is **get-or-create**: an open (unsubmitted) quiz attempt for the segment is returned as-is (same served set + order — mid-quiz resume); otherwise draw + insert `attempt_no = quiz_attempts_used + 1`. |
| E2 | Heartbeats accepted only for segments in `watching`/`must_rewatch` (a `must_rewatch` heartbeat first flips the state to `watching`), plus the §6.6 prefetch mint exception. Ranges are validated (`0 ≤ start < end ≤ duration_s`, else 422) and merged server-side; `watched_pct = merged_seconds / duration_s × 100` capped at 100. |
| E2b | **Wall-clock is SERVER-measured.** `watch_seconds` accrues `min(now − last_heartbeat_at, 45 s)` per accepted heartbeat — the client's `elapsed_s` is advisory/logged only. Accrual is per ATTEMPT+segment regardless of principal or session, so two parallel viewers (in-app + link) cannot stack time faster than wall clock. |
| E2c | **Rewatch resets everything (R2).** Entering `must_rewatch` zeroes `watched_ranges`, `watched_pct`, `watch_seconds`, and `resume_position_s` for that segment (prior values live on in `training_events`). The watch gate (E3) must be re-earned from zero each cycle. |
| E3 | Watch gate to reach `ready_for_quiz`: `watched_pct ≥ watch_threshold_pct` AND `watch_seconds ≥ 0.9 × (watch_threshold_pct/100) × duration_s` — the wall-clock guard scales with the configured threshold so thresholds below 90 remain reachable. |
| E4 | Grading: score = correct/served × 100, rounded to 2 dp. `select_mode='multi'` questions require exact set match. Graded strictly against the PINNED `course_version.content` (never draft tables). |
| E5 | Double-submit safety at BOTH ends: the `quiz/start` insert is deduped by the unique `(attempt_id, segment_key, attempt_no)` index (get-or-create), and `quiz/submit` grades via `UPDATE … SET submitted_at = now(), … WHERE id = $1 AND submitted_at IS NULL RETURNING` — 0 rows ⇒ 409; R2/R3 side effects run only in the winning transaction. |
| E6 | R3 reset: attempt → `reset`, new attempt row `attempt_no+1`, fresh progress rows (all `locked`, first in-scope segment `watching`). Same `course_version_id` (content stays pinned). Event `attempt_reset` written. |
| E7 | Course passed when ALL in-scope segments are `passed` → attempt `passed`, `score_pct` = mean of best segment scores, `completed_at` set. Certificate + completion email fire (Phase 5). Assignment → `completed`; active links + device sessions revoked. |
| E8 | Segment order comes from the pinned version's `segments` array filtered by assignment `scope`; `locked` → `watching` unlock strictly sequential within the scope. Scope keys are validated against the version at assignment creation AND attempt start — an empty intersection is a 409, never a vacuous instant-complete. |
| E9 | Assignment lifecycle: past `due_at` = **overdue** (badges, reminders — still fully workable). Past `due_at + TRAINING_EXPIRE_GRACE_DAYS` (default 30) = **expired**, applied lazily on any learner/admin access (no cron): assignment → `expired`, active attempt → `expired`, links + sessions revoked, learner endpoints 410. `revoked` behaves the same immediately. Link exchange checks assignment status, not just link-row validity. |
| E10 | **Attempt creation is one idempotent path for both principals**: get-or-create the active attempt on first learner access (`GET /learner/attempt` for app users; link exchange for link users), pinning `course_version_id = current_published_version_id` at that moment and flipping the assignment `pending/sent → in_progress`. Assignment creation and `send` both 409 if the course has no published version. |
| E11 | **One viewer at a time per attempt**: in-app access (Supabase principal) to an assignment with an active device session revokes that session (and vice versa: a link exchange is the only thing that creates one, already revoking predecessors). Combined with E2b, parallel-viewing games gain nothing. |

### 5.3 Rules config schema (Zod, in `packages/shared/src/training.ts`)

```ts
export const trainingRulesSchema = z.object({
  pass_pct: z.number().int().min(50).max(100).default(80),
  watch_threshold_pct: z.number().int().min(50).max(100).default(90),
  max_segment_attempts: z.number().int().min(1).max(10).default(3),
  shuffle_questions: z.boolean().default(true),
  shuffle_choices: z.boolean().default(true),
});
```
All shared Zod schemas + TS types for training live in `packages/shared/src/training.ts`
(imported by web and api — single source of truth, house convention).

---

## 6. Video pipeline & cost control

### 6.1 Upload (admin, browser → Supabase directly; bytes never transit Railway)

1. Admin picks a file in the course builder. Client rejects files > `TRAINING_MAX_UPLOAD_MB`
   before uploading (advisory UX only — the ENFORCED limits are the bucket's `file_size_limit`
   + `allowed_mime_types` and the project Global file size limit, §4.8).
2. `POST /api/training/admin/videos` → API inserts `training_videos` row (`status='uploading'`),
   calls `createSignedUploadUrl` for `training-videos/<org_id>/<video_id>/raw.mp4`, returns it.
   The signed-upload token is valid **2 h (fixed by Supabase)** — plenty for 200 MB on any
   plausible connection.
3. Client uploads directly to Supabase Storage. Two mechanisms, by size: ≤ ~50 MB → plain
   `uploadToSignedUrl` PUT; larger → **tus-js-client** against `/storage/v1/upload/resumable`
   passing the signed token in the `x-signature` header (6 MB chunks, session resumable ~24 h) —
   these are different code paths, not one URL.
4. `POST /api/training/admin/videos/:id/complete` → API verifies the object exists (head), stores
   `raw_bytes`, flips `status='queued'`, and enqueues the transcode job (§6.3). The video becomes
   `ready` (and publishable) only after compression succeeds.

### 6.2 Playback (signed URL minting — the metered chokepoint)

- Learner player calls `GET /api/training/learner/segments/:segmentKey/video-url?quality=hd|low`.
- API verifies the segment is unlocked for the caller's attempt (E2 — with the §6.6 prefetch
  relaxation), checks the org egress budget (§6.5), logs `training_delivery_log(bytes_est =
  chosen rendition's bytes)` — deduped per (attempt, video, rendition)/24 h (§4.5) — asserts the
  row's `storage_path` starts with its own `org_id/`, mints a signed URL with TTL
  `TRAINING_SIGNED_URL_TTL_MINUTES` (default **15** — short on purpose: a Supabase signed URL is
  a bearer link anyone can fetch; §14), writes `video_url_minted` event, returns it.
- The player requests a fresh URL on resume/expiry — URLs are never persisted client-side; the
  §12.5 error-recovery path makes re-mints invisible to the driver.

### 6.3 Automatic server-side compression (transcode-on-upload)

**Decision (2026-07-23): every upload is compressed once, server-side, before it can be
published.** Admins upload whatever their screen recorder produces; the API normalizes it. This
is what keeps egress low forever — one CPU-bound transcode per upload buys a 3–6× smaller file on
every single view.

Pipeline (`apps/api/src/services/training/transcode.ts`, coordinated through the existing `jobs`
ledger, kind `training_transcode` — one active job per org drains a queue of `queued` videos
sequentially, matching the ledger's one-active-run-per-(org,kind) design):

1. Job picks the oldest `queued` video → `status='transcoding'` → downloads `raw.mp4` to
   `/tmp` via service role.
2. `ffprobe` extracts duration (+ sanity: has video stream, duration 10 s–30 min) →
   stores `duration_s`.
3. Transcode — BOTH renditions in ONE ffmpeg invocation (decode once, two outputs), fast
   preset (a 15-min 1080p input at `-preset slow` ×2 sequential encodes would take 5–15 min on
   Railway's shared vCPUs while competing with the live API — `veryfast` cuts that ~5–10× and,
   for near-static screencast content, costs only a few % in size; we compensate with CRF −1):
   ```
   ffmpeg -protocol_whitelist file,pipe -nostdin -i raw.mp4 \
     -map 0 -c:v libx264 -preset veryfast -crf $((TRAINING_TRANSCODE_CRF - 1)) \
       -vf "scale=-2:min(ih\,$TRAINING_TRANSCODE_MAX_HEIGHT)" \
       -r $TRAINING_TRANSCODE_MAX_FPS -pix_fmt yuv420p \
       -c:a aac -b:a 64k -ac 1 -movflags +faststart play_hd.mp4 \
     -map 0 -c:v libx264 -preset veryfast -crf 31 \
       -vf "scale=-2:min(ih\,720)" -r 10 -pix_fmt yuv420p \
       -c:a aac -b:a 48k -ac 1 -movflags +faststart play_low.mp4
   ```
   Run with a **30-min watchdog timeout** (kill → `failed`) and `nice`d; `-protocol_whitelist`
   + `-nostdin` harden against demuxer tricks in hostile inputs (uploads come from trusted
   admins, but cheap belts are cheap). HD defaults (env, §15): CRF **28**, max height **1080**
   (keep native res so on-screen text stays legible), max fps **15** (raise for motion footage).
   Data-saver: 720p / CRF 31 / 10 fps / 48 kbps mono ≈ **0.12–0.2 Mbps** — watchable on
   truck-stop 3G; voiceover (where the teaching lives) stays crisp. `+faststart` on both.
   Expected wall time: **~1–3 min for a 15-min 1080p input** — the builder chip says
   "Compressing — usually a couple of minutes", not "seconds".
4. Upload both renditions (`storage_path` = HD, `low_path` = data-saver), store `bytes` +
   `low_bytes`, delete `raw.mp4`, `status='ready'`. If ffmpeg fails or the HD output is somehow
   LARGER than raw (already-optimized input): keep the smaller as HD. On error:
   `status='failed'` + `transcode_error`; admin UI shows a retry button (re-enqueue).
   **Crash recovery:** on api-service boot, sweep `status='transcoding'` rows (and their stale
   ledger rows) back to `queued` and clean `/tmp` — a deploy mid-transcode must never strand a
   video or wedge the one-active-job queue. An `updated_at` staleness threshold (45 min) catches
   the multi-instance case.
5. Builder UI shows a live status chip per video (uploading → queued → compressing → ready, with
   raw→compressed sizes, e.g. "142 MB → 21 MB"). Publish validation requires `ready`.

**Expected sizes** — HD (CRF 28 @ 15 fps ≈ 0.3–0.6 Mbps): a 5-min segment ≈ **12–25 MB**,
a 30-min course ≈ **70–135 MB**. Data-saver: a 5-min segment ≈ **5–8 MB**. Storage cost of the
second rendition is trivial (~40% extra on tiny files); its egress SAVINGS on slow-network
drivers are large.

**Runtime requirement:** ffmpeg must exist in the api service image. `railway.json` currently
pins `"builder": "NIXPACKS"` → set `NIXPACKS_PKGS=ffmpeg` on the api service. **If the service
is ever migrated to Railway's newer Railpack builder, that env var is a silent no-op — use
`RAILPACK_DEPLOY_APT_PACKAGES=ffmpeg` instead.** Phase 0's `ffmpeg -version` acceptance check
exists precisely to catch this. Transcodes are throttled to one at a time per
process, run at `nice` priority, and short videos take well under a minute — no impact on API
latency at this scale. Guard: skip scheduling inside the web/admin services (same pattern as
`RUN_SCHEDULERS_IN_PROCESS`).

### 6.4 Provider abstraction (the escape hatch)

`apps/api/src/services/training/videoDelivery.ts`:

```ts
export interface VideoDeliveryProvider {
  createUploadTarget(orgId: string, videoId: string, filename: string):
    Promise<{ uploadUrl: string; storagePath: string }>;
  confirmUpload(storagePath: string): Promise<{ bytes: number }>;
  getPlaybackUrl(storagePath: string, ttlSeconds: number): Promise<string>;
  deleteObject(storagePath: string): Promise<void>;   // drafts only — published video refs are permanent
}
export function makeVideoDelivery(env: Env): VideoDeliveryProvider  // switch on env.TRAINING_VIDEO_PROVIDER
```
Phase 1 implements `supabaseStorageProvider`. A future `bunnyStreamProvider` /
`cloudflareStreamProvider` implements the same interface (storage_path holds the provider's video
GUID; playback URL becomes a tokenized HLS/iframe URL). **Nothing outside this file knows which
provider is active.**

### 6.5 Egress budget (hard requirement — D1/D2)

- Env `TRAINING_MAX_MONTHLY_EGRESS_GB` (default **100**) per org, PLUS
  `TRAINING_MAX_MONTHLY_EGRESS_GB_GLOBAL` (default **180**) summed across ALL orgs — the real
  constraint (Supabase Pro's 250 GB) is account-wide, so per-org budgets alone can't protect it
  under multi-org (D2).
- On every URL mint: check org month-sum AND global month-sum from `training_delivery_log`
  (mints are deduped per (attempt, video, rendition)/24 h — §4.5 — so re-mints, downswitches,
  and prefetch repeats don't inflate the meter).
  - ≥ 80% of either budget → still serve; write `egress_warning` event once per day; surface a
    banner on the Safety → Training admin pages.
  - ≥ 100% → refuse with 429 + friendly learner message ("training temporarily unavailable");
    admins raise the env or grant a temporary bump via `training_egress_overrides` (§4.5,
    admin-only endpoint, per org per month).
- Metering honesty: with prefetch fetching whole files, `bytes_est` ≈ real egress for normal
  use. What it can UNDER-count is a signed URL fetched repeatedly during its TTL (shared or
  scripted) — the 15-min TTL bounds that window; provider-side analytics (the §6.4 swap) is the
  only exact meter. Treat the budget as a strong guardrail, not an invoice.
- **Reality check at target scale (updated 2026-07-23 — org is on Supabase Pro):** with the
  transcode pipeline (§6.3) a 30-min course is ~70–135 MB per full watch ⇒ 250 drivers ≈
  **18–34 GB per course rollout** — comfortably inside Pro's 250 GB/mo included egress. Without
  compression the same rollout would be 3–6× that, which is exactly why §6.3 is mandatory, not
  optional. Pro egress is SHARED with DB/API traffic, so the meter + banner stay. Provider swap
  (§6.4) remains the escape hatch if sustained monthly egress ever trends past ~150 GB.

### 6.6 Slow-connection strategy (drivers on phones, truck-stop Wi-Fi, rural LTE)

Small single-bitrate MP4s make real ABR unnecessary; these five behaviors cover the same ground:

1. **Auto quality pick.** On player mount: if `navigator.connection.effectiveType` is `2g`/`3g`
   or `downlink < 1.5` → start on data-saver; else HD. Unsupported browser → HD. **iOS Safari
   has no Network Information API at all**, so EVERY iPhone starts on HD and relies on the
   stall downswitch — that path is the NORMAL iOS path and gets first-class testing, not an
   edge case.
2. **Stall-based downswitch.** Count `waiting` events; ≥3 stalls in 60 s while on HD → seamlessly
   swap `src` to the data-saver URL at the same `currentTime` and toast "Switched to data saver".
   Watched-ranges tracking is rendition-agnostic (same timeline), so progress is unaffected.
3. **Manual toggle.** A quality control in the player (HD · Data saver — labeled with sizes,
   e.g. "HD · 21 MB" / "Data saver · 6 MB"). Choice persists for the sitting and is remembered
   per device.
4. **Prefetch the next segment during the quiz.** While the driver answers segment N's questions,
   the player silently prefetches segment N+1's video (fetch → blob) in the already-chosen
   quality. On a slow connection the next video is ready by the time the quiz is done —
   perceived loading time ≈ 0. *E2 relaxation:* the mint endpoint may issue segment N+1's URL
   once segment N is in `ready_for_quiz` or later — watching ahead is harmless; COMPLETION order
   stays strictly sequential (E1/E8 unchanged).
5. **Full-segment buffering + indicator.** Segments are small enough to buffer completely
   (`preload="auto"`); the seek bar shows the buffered region so drivers see the download
   progressing even before pressing play.

---

## 7. Auth model & one-time email links

### 7.1 Two principals, one learner API

| Principal | Who | Token | Guard |
|-----------|-----|-------|-------|
| App user | Logged-in member (driver with login, dispatcher, …) | Supabase JWT (existing) | `requireAuth` + row-level self-checks (assignment belongs to caller) |
| Link session | Email-link recipient (usually driver without login) | **Training session JWT** minted by our API: `{ sub: "assignment:<id>", org_id, session_id, exp: +TRAINING_SESSION_TTL_HOURS (4h) }`, HS256 with `TRAINING_JWT_SECRET`; silently renewed via the rotating device-session refresh token (§7.2) | New middleware `requireTrainingSession` in `apps/api/src/middleware/trainingAuth.ts` |

Learner routes accept EITHER principal via a small resolver middleware (`resolveLearner`).
Verification is strict per principal: each token is verified against ITS OWN secret with
`algorithms:['HS256']` pinned (Supabase JWTs and training JWTs are both HS256 — the principal
is decided by WHICH verification succeeds, never by a claim in the token), and
`TRAINING_JWT_SECRET` must be distinct from the Supabase JWT secret. The resolver produces
`{ orgId, assignmentId, actorKind, actorId }` and every handler scopes queries to that — for a
link principal, any `assignment_id`/`:segmentKey` in the request is verified against the
token's own assignment (mismatch ⇒ 404), and for an app principal the assignment is
ownership-checked against `auth.uid()` before anything is returned (no IDOR via query params). The scoped JWT can access **nothing** outside its one assignment.

### 7.2 Link lifecycle — STRICTLY SINGLE-USE (revised 2026-07-23, R8)

The emailed link is consumable **exactly once**. Continuity across sittings comes from a
device-bound session created at that one exchange — the link itself can never be replayed or
shared after first use.

1. **Issue** (admin clicks "Send"): generate `crypto.randomBytes(32).toString('base64url')`
   (256-bit; NOT UUIDs). Store only `sha256(token)` in `training_links.token_hash`. Revoke prior
   unused links for the assignment. Email the raw link `https://<app>/t/<token>` via `sendEmail`.
   Event `link_issued`.
2. **Open** (GET `/t/<token>`, public SPA route): interstitial shows course title + "Start
   training" button. **The GET consumes nothing** — this defeats Outlook SafeLinks/AV scanners
   that prefetch GET links (they would otherwise burn the single use before the driver ever
   clicks). `GET /training/links/preview` is likewise side-effect-free.
3. **Exchange** (button → `POST /api/training/links/exchange` `{token}`): atomic single-use
   consume —
   `UPDATE training_links SET used_at = now(), used_ip = $ip, used_ua = $ua
    WHERE token_hash = $hash AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
    RETURNING …` (0 rows ⇒ 410 Gone). On success, in the same transaction: revoke any older
   device session for the assignment (one active device — the unique partial index enforces it),
   create `training_device_sessions` (+ 30-day rotating refresh token, §4.4), create the attempt
   on first exchange (pinning `course_version_id`). Returns `{ session_jwt (4h),
   refresh_token }`. Client stores the refresh token in `localStorage` keyed by assignment.
   Events `link_exchanged` / `link_denied`.
4. **Resume — same device** (§6.6/interrupted sessions): when the 4h JWT expires or the driver
   returns days later, the SPA calls `POST /api/training/sessions/refresh` `{refresh_token}` →
   rotate atomically (`UPDATE … SET refresh_token_hash = $new, prev_token_hash = $old,
   expires_at = now() + TTL WHERE refresh_token_hash = $old AND revoked_at IS NULL RETURNING`;
   the sliding `expires_at` means an active driver is never evicted mid-course) → fresh 4h JWT →
   the player resumes at `resume_position_s`. **Grace window:** the immediately-previous token
   (`prev_token_hash`) is honored for ≤60 s after rotation and answered with the CURRENT token —
   so a second tab, a flaky-network retry, or a race doesn't read as theft. **Replay of any
   OLDER rotated token ⇒ revoke the whole session + event `session_reuse_detected`** — a copied
   localStorage token dies the moment both copies try to live. (Accepted, documented risk: an
   XSS on the web origin could exfiltrate the refresh token; blast radius is one assignment's
   training — no org data, no other users. The mobile app uses OS secure storage instead.)
5. **Resume — new device / cleared storage:** the old link is dead (used), so the interstitial
   shows *"This link was already used. Send me a fresh link"* → `POST
   /api/training/links/request-new` `{token}` → eligibility: the token (used OR expired — both
   qualify, same screen) maps to an assignment that is incomplete, not revoked/expired, AND the
   link row is **≤ `TRAINING_LINK_TTL_DAYS × 2` old** — a bounded window, so an old forwarded
   email can't act as a permanent reissue trigger years later. On success: email a FRESH
   single-use link to the assignment's stored `email_to` (never a caller-supplied address),
   revoke the old device session. Self-service, no admin needed. Event `link_reissued_self`.
   iOS note: Safari can evict localStorage after ~7 days of disuse (ITP), so this flow — reopen
   the email, tap, get a fresh link — is the NORMAL iPhone comeback path; UX copy must not
   promise 30-day same-device resume on iOS. Outside the window / ineligible → "contact your
   safety manager".
6. **Resend/revoke (admin):** resend = revoke unused links + sessions, issue fresh. Revoke =
   assignment 410 everywhere. Completion (E7) revokes link + session automatically.

Why this satisfies "one-time use": the mailbox link works once; a forwarded email is dead after
the first opener; a second device can only get in by receiving a NEW link at the original
driver's mailbox; parallel viewing is impossible (one active session); and a stolen refresh
token self-destructs on concurrent use. Combined with short-TTL signed video URLs and the R8
watermark, casual copying/sharing of videos and tests is blocked at every cheap layer.

Rate limits — the SECURITY-relevant ones are enforced **durably in Postgres**, not process
memory (in-memory counters reset on every Railway deploy and multiply under horizontal
scaling): request-new = count of `training_links` rows created per assignment per day (≤3);
failed-token lookups = count of `link_denied` events per IP per hour (≤20). The cheap
liveness limits (exchange 10/min/IP, refresh 30/hour/session) may stay in-memory — the DB's
atomic single-use/rotation guards are the real defense there. All denials logged.

---

## 8. API surface (all under `apps/api/src/routes/training/`)

Router files kept small per lint:filesize: `adminCourses.ts`, `adminVideos.ts`,
`adminAssignments.ts`, `adminReports.ts`, `links.ts`, `learner.ts`, wired in `index.ts` as
`/training`. `SAFETY_MANAGE = rolesThatManage("safety")` → `requireRole(...SAFETY_MANAGE)`.

### 8.1 Admin (requireAuth + requireOrg + requireRole(...SAFETY_MANAGE))

| Method & path | Purpose |
|---------------|---------|
| `GET  /training/admin/courses` | List courses + version/assignment counts |
| `POST /training/admin/courses` | Create draft course |
| `GET  /training/admin/courses/:id` | Full draft (segments, questions, videos, rules) + version history |
| `PATCH /training/admin/courses/:id` | Update title/description/rules (draft only) |
| `POST /training/admin/courses/:id/segments` · `PATCH/DELETE …/segments/:segId` | Segment CRUD + reorder (draft only) |
| `POST …/segments/:segId/questions` · `PATCH/DELETE …/questions/:qId` | Question CRUD (draft only) |
| `POST /training/admin/videos` → `POST /training/admin/videos/:id/complete` | Upload handshake (§6.1) |
| `POST /training/admin/videos/:id/captions` | Upload/replace WebVTT captions (small file, via API body — no signed-URL dance) |
| `POST /training/admin/videos/:id/retry` | Re-enqueue a `failed` transcode |
| `POST /training/admin/courses/:id/publish` | Snapshot → new immutable version (§4.3) |
| `POST /training/admin/courses/:id/archive` | Hide from new assignments (existing attempts unaffected) |
| `GET  /training/admin/assignments?course_id=&status=` | Assignment board with live progress |
| `POST /training/admin/assignments` | Bulk create: `{course_id, subjects:[{driver_id?|user_id?, email_to?}], scope, due_at, channel:'email'|'in_app'}` — `email_to` is PER SUBJECT; creation 409s if the course has no published version (E10), if any scope key is missing from the current version (E8), or if a subject is unreachable on the chosen channel (email channel with no resolvable address / in_app with no login) |
| `POST /training/admin/assignments/:id/send` | (Re)issue link + send email (channel email) |
| `POST /training/admin/assignments/:id/revoke` | Revoke assignment + links |
| `GET  /training/admin/assignments/:id` | Detail: attempts, per-segment progress, quiz history, events |
| `GET  /training/admin/reports/summary` | Org rollup (§11) |
| `GET  /training/admin/certificates/:attemptId/url` | Signed cert PDF URL |

Validation: every body parsed with Zod schemas from `packages/shared/src/training.ts`. Ownership:
every `:id` fetched WHERE `org_id = <jwt org>` before any write (house rule B5).

### 8.2 Link exchange (public, rate-limited)

| Method & path | Purpose |
|---------------|---------|
| `GET  /training/links/preview?token=` | SAFE metadata for the interstitial (course title, org name, used/expiry state). Looks up by hash; no side effects. |
| `POST /training/links/exchange` | §7.2 step 3 → `{ session_jwt, refresh_token, assignment_id }` (single-use consume) |
| `POST /training/sessions/refresh` | §7.2 step 4 → rotate refresh token, new 4h JWT; reuse ⇒ session revoked |
| `POST /training/links/request-new` | §7.2 step 5 → fresh link to the ORIGINAL email; 3/day/assignment |

### 8.3 Learner (Supabase JWT **or** training session JWT via `resolveLearner`)

| Method & path | Purpose |
|---------------|---------|
| `GET  /training/learner/assignments` | (App users only) list my assignments — drives "My Training" |
| `GET  /training/learner/attempt?assignment_id=` | Current attempt state: segments (learner-safe projection: NO correct_keys), states, watched_pct, attempts_used, rules |
| `GET  /training/learner/segments/:segmentKey/video-url` | Signed playback URL (§6.2) + signed `captions_url` when the video has captions |
| `POST /training/learner/segments/:segmentKey/heartbeat` | `{ranges:[[s,e],...], position, elapsed_s}` every 15 s + on pause/ended → server merges (E2/E3), returns updated state |
| `POST /training/learner/segments/:segmentKey/quiz/start` | Draw + shuffle questions (R5), insert `training_quiz_attempts` (served set), return questions without answers |
| `POST /training/learner/segments/:segmentKey/quiz/autosave` | `{quiz_attempt_id, answers}` — patches `answers` on the OPEN attempt (submitted ⇒ 409); powers mid-quiz resume with selections restored |
| `POST /training/learner/segments/:segmentKey/quiz/submit` | `{quiz_attempt_id, answers}` → grade (E4/E5) → returns `{score_pct, passed, per_question:[{qid, correct, explanation}], next_state}` and applies R2/R3 |
| `POST /training/learner/attempt/attest` | `{typed_name}` — records attestation (§10); required before certificate |
| `GET  /training/learner/certificate-url` | Signed URL for my cert PDF (once passed + attested) |

---

## 9. Future mobile app — what this plan already guarantees

The driver mobile app will authenticate either as a Supabase user (if drivers get logins) or by
deep-linking a training link (`fuelguard://t/<token>` falls back to `https://<app>/t/<token>`),
then calls the SAME `/training/links/exchange` + `/training/sessions/refresh` +
`/training/learner/*` JSON endpoints — the app stores the rotating refresh token in secure
storage exactly like the web player uses localStorage (single-use links work unchanged). Nothing in
those endpoints is browser-specific (no cookies — Authorization header only). Keep it that way:
**do not introduce cookie-based session state in the learner API.** Push-notification reminders
replace email nudges later; the assignment/link model is unchanged.

---

## 10. Compliance records, attestation, certificates (Phase 5)

Modeled on 49 CFR Part 380 Subpart G record expectations (we are not an ELDT provider; this is
the bar auditors/insurers recognize).

- **Per completed attempt we can reconstruct:** who (driver name + employee_id or member email),
  what (course title + exact `course_version_id` content incl. the questions served), when
  (started/completed timestamps, per-segment watch data, per-quiz timings), how well (scores,
  attempts used), how long (`total_active_seconds`), and the attestation (typed name, timestamp,
  IP, UA) — all across `training_attempts` + children + `training_events`.
- **Attestation:** before the certificate issues, the learner must check
  *"I certify that I personally completed this training"* and type their full name
  (`POST /attempt/attest`). Stored on the attempt; stamped on the certificate.
- **Certificate PDF:** generated server-side on pass+attest (`pdfkit@0.19.1` is already a dependency of
  `apps/api` — use it): org name/logo, driver name, course title +
  version, scope (full / segments list), score, completion date, cert_number, attestation line.
  Stored in `training-certs`, row in `training_certificates`. The completion email links to it
  with a **24-hour** signed URL (it contains PII — a 7-day bearer link in an inbox is too long);
  after that, re-mint any time from the app / by asking the safety manager.
- **Honest evidentiary framing (important for D4):** quiz scores, attempt counts, timestamps,
  server-measured wall-clock time (E2b), and the attestation are strong records. Watched-ranges
  are **good-faith telemetry, not proof** — a technically capable user can fabricate heartbeat
  payloads (R7 accepts this; the wall-clock floor is the hard part to fake). And for the email
  channel, identity ultimately rests on mailbox control + a typed name — see open question #2
  (second identity factor) before treating email-channel completions as strongly attributed.
- **Retention:** never hard-delete `training_attempts`, `training_quiz_attempts`,
  `training_events`, `training_certificates`, or published `training_course_versions`.
  Course "delete" = archive. Driver deletion keeps training rows (FK is to drivers row which is
  soft-status'd already). Document 3-year minimum in OrgSettings help text.
- **Export:** `GET /training/admin/reports/summary?format=csv` gives the auditor-friendly export
  (driver, course, version, assigned/completed dates, score, duration, cert number).

## 11. Scoring & reporting (Phase 5)

- **Segment score** = best passed quiz score for that segment in the attempt.
- **Course score** = mean of in-scope segment scores (2 dp) — stored on the attempt at pass.
- **Admin dashboard** (`/safety/training` overview + `/safety/training/reports`):
  per-course completion funnel (assigned → started → completed), overdue list (past `due_at`),
  average scores per segment (identifies confusing content), failure hotspots (questions most
  missed — from `training_quiz_attempts.answers` vs served), egress usage vs budget.
- **Driver Performance tie-in (later, optional):** training completion % can join the existing
  driver scoring (`docs/16-DRIVER-PERFORMANCE.md`) as a coaching signal. Out of scope for v1 —
  noted so nobody bolts it on ad hoc.

## 12. Web UI

### 12.1 Routes to add (`apps/web/src/router/index.ts`)

| Path | Page | Guard |
|------|------|-------|
| `/safety/training` | `TrainingCoursesPage.vue` | canManageSection('safety') — same meta pattern as Anomalies |
| `/safety/training/courses/:id` | `TrainingCourseBuilderPage.vue` | manage safety |
| `/safety/training/assignments` | `TrainingAssignmentsPage.vue` | manage safety |
| `/safety/training/reports` | `TrainingReportsPage.vue` | view safety (auditor sees read-only) |
| `/my-training` | `MyTrainingPage.vue` | requiresAuth (any role — self-scoped) |
| `/my-training/:assignmentId` | `TrainingPlayerPage.vue` | requiresAuth |
| `/t/:token` | `TrainingLinkPage.vue` (interstitial → embeds the same player feature) | PUBLIC (like `/accept-invite`) |

Nav (`apps/web/src/lib/nav.ts`): add "Training" under the Safety group (visible per
`canViewSection('safety')`); add "My Training" as an ungated personal item (pattern: Fuel Log)
shown when the user has ≥1 assignment.

### 12.2 Feature module `apps/web/src/features/training/`

```
features/training/
├─ api.ts                 # typed client for /api/training/* (reuses lib/api client + shared Zod types)
├─ builder/               # admin authoring
│  ├─ CourseForm.vue  SegmentList.vue  SegmentEditor.vue  QuestionEditor.vue
│  ├─ VideoUpload.vue     # signed-upload flow §6.1, duration probe, progress bar
│  └─ PublishPanel.vue    # validation results, version history, publish button
├─ assign/
│  ├─ AssignmentBoard.vue # table w/ live progress, filters, overdue badges
│  ├─ AssignDialog.vue    # pick course(+scope segments for re-training), subjects (drivers/members multi-select), due date, channel
│  └─ AssignmentDetail.vue
├─ player/                # SHARED by /my-training/:id and /t/:token
│  ├─ TrainingPlayer.vue  # stepper: video → quiz → next; drives everything off GET /attempt
│  ├─ SegmentVideo.vue    # <video> w/ signed URL, watched-ranges tracker, seek-lock on first watch,
│  │                      #   15s heartbeat, resume-at-position, quality auto/toggle + stall downswitch (§6.6),
│  │                      #   next-segment prefetch, moving watermark overlay (R8), nodownload/no-PiP
│  ├─ SegmentQuiz.vue     # one question per screen, progress, submit → result view (R2/R3 messaging)
│  ├─ AttestDialog.vue  CompletionView.vue  ResetNotice.vue
│  └─ useAttempt.ts       # Vue Query hooks + state machine mirror (render-only; server is authoritative)
└─ reports/ ReportsSummary.vue  QuestionHotspots.vue  EgressBudgetCard.vue
```

UI kit: build from `/TemplatesTailwind` components (house rule — don't reinvent). Player must be
flawless on mobile Safari/Chrome (drivers use phones): big tap targets, portrait layout,
`playsinline`, no hover-dependent controls.

### 12.3 Learner UX details that implement the rules

- Locked segments show 🔒 + "Complete previous segment first" (R1).
- After failed quiz: full-screen notice "Score 60% — you need 80%. Rewatch the video to try
  again. Attempts left: 1" (R2), video restarts at 0 with seek-lock re-enabled.
- After 3rd fail: "Course restarted — please complete all segments again" (R3) with fresh stepper.
- Interstitial (`/t/:token`): course title, estimated duration, org branding, single **Start
  training** button (POST exchange §7.2). Used link → "Already used — send me a fresh link"
  self-service button (§7.2 step 5). Expired/revoked → clear message + "contact your safety
  manager".
- **Interrupted sessions — resume is a first-class guarantee.** ALL progress lives server-side
  (watched ranges, `resume_position_s`, segment states, quiz attempt state), so closing the
  browser mid-video or mid-quiz loses nothing. Reopening (in-app, or via refresh-token renewal
  on the same device) lands on a **"Continue where you left off"** card: course progress bar,
  next action ("Resume video at 3:12 of Segment 2" / "Finish quiz — question 4 of 8"), one
  button. A quiz interrupted mid-attempt re-serves the SAME drawn questions in the same order
  (persisted on the quiz attempt row) with prior selections restored from the last autosave
  (`answers` autosaved on every selection via the heartbeat channel, graded only on submit).
- Session JWT expiry mid-sitting: silent `POST /sessions/refresh` (§7.2 step 4) — the driver
  never sees an auth interruption; on refresh failure (revoked/expired session) → the
  request-new-link screen.
- Slow connection: quality auto-pick + stall downswitch + prefetch-during-quiz (§6.6); the UI
  shows a subtle "Data saver" badge when active so support calls are explainable.

### 12.4 Visual design spec — player, quiz, and flow (match the dashboard exactly)

Source of truth: `docs/DESIGN-SYSTEM.md` + `apps/web/src/components/ui/*`. The training UI uses
ONLY existing primitives and semantic tokens — zero new colors, zero raw palette utilities. A
static HTML mockup of these screens ships alongside this plan (`training-player-mockup.html`)
as the visual reference.

**Shared shell.** Admin pages render inside the normal AppShell (sidebar + `w-full px-4 sm:px-6
lg:px-8 py-8`). Learner surfaces (`/my-training/*`, `/t/:token`) render in a minimal centered
shell — `bg-canvas` page, `mx-auto max-w-2xl` column, FuelGuard logo top-left, no sidebar (email
-link users have no nav rights; in-app users get a plain "Back to My Training" breadcrumb).

**Interstitial (`/t/:token`).** One `BaseCard` (`padding md`): org name in `text-ink-muted
text-sm`, course title `text-ink text-xl font-semibold`, meta row (segments count, est.
duration, due date) as `text-ink-secondary text-sm` with Heroicons, then a full-width
`BaseButton variant=primary block` ("Start training"). Expired/used states swap the button for a
`bg-warning-50 text-warning-800 ring-warning-200` soft panel + secondary action.

**Player screen.** Vertical stack (`space-y-6`):
1. *Progress stepper* — horizontal on desktop, compact "Segment 2 of 5" + thin
   `bg-brand-600` progress bar on mobile. Steps use the badge tones: done =
   `success` check circle, current = `brand` ring, locked = `ink-subtle` lock icon.
2. *Video card* — `BaseCard padding none`, video edge-to-edge with `rounded-t-lg`; 16:9 black
   letterbox; watermark overlay (`text-white/25 text-xs`, driver name + date, absolute,
   repositions ~20 s). Below the video inside the card: title row (`text-ink font-medium`) +
   duration, buffered/seek bar (seek-lock: past-max handle drags snap back with a gentle
   tooltip "Finish watching first"), controls row — play/pause, mute, playback position
   `tabular-nums text-ink-muted text-sm`, quality menu via `KebabMenu #trigger` (HD ·
   Data saver with sizes), fullscreen. Controls are 44px min tap targets, `playsinline`.
3. *Continue row* — `BaseButton primary block` "Continue to quiz" appears (fade-in) only when
   watched ≥ threshold; before that a `text-ink-muted text-sm` hint "Watch to the end to
   unlock the quiz · 82%".

**Quiz screens.** One question per screen inside a `BaseCard padding md`:
header row "Question 3 of 8" (`text-ink-muted text-sm`) + segment title chip (`StatusBadge`
neutral); prompt `text-ink text-base font-medium`; choices as large radio cards (`FormField`
semantics): `rounded-md ring-1 ring-edge-strong p-4` default, selected =
`ring-2 ring-brand-600 bg-brand-50`, focus ring per convention. Footer: ghost "Back" +
primary "Next / Submit answers". Autosave indicator (`text-ink-subtle text-xs` "Saved").
NO per-question correctness reveal mid-quiz — results come after submit (R6 keeps answers
server-side anyway).

**Result states** (full-card takeovers, consistent iconography):
- *Passed segment:* `success-50` panel, big check, "92% — passed", per-question review list
  (correct = success check, wrong = danger x + explanation text `text-ink-secondary text-sm`),
  primary "Next segment" (prefetched video starts instantly — §6.6.4).
- *Failed, attempts left (R2):* `warning-50` panel: "68% — you need 80%", `StatusBadge` warning
  "Attempts left: 1", explanation of the rewatch rule, primary "Rewatch video".
- *Course reset (R3):* `danger-50` panel, "Course restarted", body copy explains why, primary
  "Start from Segment 1". Tone factual, not punitive.
- *Course complete:* `success` hero card: score, duration, cert number; attestation dialog
  (`FormField` typed-name input + `BaseCheckbox` certification statement) → then
  "Download certificate" (`BaseButton secondary`) + completion email note.

**Admin pages.** Standard page recipes, nothing bespoke: `PageHeader` + `FilterBar` +
`DataTable` everywhere. Courses list columns: title, status (`StatusBadge`: draft=neutral,
published=success, archived=warning), version, segments, assigned/completed counts, updated,
⋮ (`KebabMenu`: edit/assign/archive/history). Builder page: two-column ≥lg (left: segment list
card with drag handles + add; right: selected segment editor — `FileDropzone` for video with
status chip uploading→queued→compressing→ready "142 MB → 21 MB", `QuestionEditor` rows,
`PublishPanel` with validation results). Assignment board columns: subject, course(+scope chip
"3 of 5 segments"), channel, status (pending=neutral, sent=info, in_progress=brand,
completed=success, expired/revoked=warning/danger badges), progress (thin bar + "2/5 · 87%"),
due (overdue = `text-danger-600 font-medium`), last activity, ⋮ (detail/remind/resend/revoke).
Reports: KPI grid (`grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4`) — assigned,
completion rate, avg score, overdue — then funnel + question-hotspot tables; charts through
`chartTheme.ts` `viz.*` tokens only. Egress budget card: progress bar `bg-brand-600`,
switching to `bg-warning-500` ≥80%, `bg-danger-600` ≥100%.

**States & a11y.** Every async surface has skeleton/error/empty via `DataTable`/`ErrorState`
conventions; toasts via `ToastContainer`. Focus-visible outlines per token conventions;
the player is fully keyboard-operable (space play/pause, arrows blocked past max-watched);
quiz radios are real inputs; all text ≥ `text-sm`; touch targets ≥ 44px; works one-handed
portrait on a 360px-wide phone.

### 12.5 Player engineering spec — modern, first-class

**Foundation:** native `<video>` + custom Vue controls (we need full control for seek-lock,
watermark, watched-ranges, and quality swaps — a 100 KB player dependency buys nothing here).
If polish drags during Phase 3, Vidstack is the approved fallback, but the gating hooks below
must remain ours either way.

**Integrity mode vs free mode.** The player has exactly two modes, switched per segment state:
*integrity mode* whenever the watch counts toward completion (first watch, and `must_rewatch`
after a failed quiz — R2): forward-seek blocked past max-watched, playback locked to 1×
(a `ratechange` listener snaps back and logs a `heartbeat_flag` event on repeated attempts).
*Free mode* once the segment is `passed`: free seeking, speed 0.75–2×, for drivers who want to
review before a later quiz or re-check a detail.

| Area | Behavior |
|------|----------|
| Core controls | Tap/click anywhere toggles play; large center state icon; **back-10s** button (⟲ 10 — always allowed); volume/mute; fullscreen; elapsed/total in tabular-nums |
| Keyboard | `Space`/`K` play-pause · `←` back 10 s · `M` mute · `F` fullscreen · `C` captions · `↑/↓` volume — all ARIA-labeled, fully focus-visible |
| Mobile | `playsinline`; double-tap left = back 10 s (no forward gesture); **Screen Wake Lock** while playing (re-acquired on `visibilitychange` — iOS releases it on tab-hide); controls auto-hide after 2.5 s, tap to reveal |
| Fullscreen | **iPhone cannot fullscreen a container** — only the NATIVE video player (`webkitEnterFullscreen`), which drops our overlays: no watermark, no seek-lock, free scrubbing. So: in integrity mode on iPhone the fullscreen button is replaced by a CSS **theater mode** (fixed-position container filling the viewport, landscape-aware) — overlays intact; real/native fullscreen is offered only in free mode (segment already passed). iPad + Android support container fullscreen and keep all overlays everywhere. |
| Media Session API | Lock-screen/notification metadata (course + segment title); phone call or headphone unplug → clean auto-pause with the heartbeat closing the watched range |
| Backgrounding | `visibilitychange` → auto-pause (integrity: hidden time never counts as watched; also saves battery/data) |
| Resume | `resume_position_s > 30` → "Resume at 3:12 / Start over" chooser; otherwise silent resume |
| Captions | Optional **WebVTT** per video (`captions_path`), uploaded in the builder alongside the video — accessibility + noisy-yard viewing; toggle in controls; styled via `::cue` to match tokens |
| Preferences | Volume, mute, captions on/off, quality choice remembered per device (localStorage) |
| Error recovery | 403 on the media request (signed URL expired mid-sitting) → silently re-mint and restore position; network drop → exponential-backoff retry + offline banner ("Reconnecting — your progress is saved"); every stall feeds the §6.6 downswitch counter |
| Quality | §6.6: auto-pick, stall downswitch at same timestamp, manual HD/Data-saver menu with sizes |
| Anti-copy | R8: moving watermark (rendered in container-fullscreen/theater mode — see Fullscreen row for why iPhone native fullscreen is avoided in integrity mode), `controlsList="nodownload"` (Chromium-only — fine), `disablePictureInPicture`, context-menu suppressed |
| Buffering UX | `preload="auto"`, buffered region shown on the seek bar, next-segment prefetch during quiz (§6.6.4) |

Definition of "really good": a driver on a 2019 Android phone in a truck cab can start, get
interrupted by a phone call, lock the screen, come back the next day on the same device, and
finish — without ever seeing a login, a lost position, a stuck spinner, or a sub-44 px tap
target.

## 13. Email flow (Resend via existing mailer)

Templates in `apps/api/src/services/training/emails.ts` (subject + html + text, same pattern as
digest/invites; keep HTML table-based, plain, mobile-friendly):

| Email | Trigger | Contents |
|-------|---------|----------|
| Assignment | admin Send | course title, why, due date, big Start button → `/t/<token>`, expiry note |
| Reminder | manual "Remind" button v1 (scheduled digest later) | same link (still-active) or fresh link if expired |
| Completion | attempt passed | score, cert link (signed URL), congratulations |
| Fresh link (self-service) | §7.2 step 5 request-new | new single-use link; note that the old one is now invalid |
| Failure escalation (optional toggle) | R3 reset fired | notify safety manager, not the driver |

Cost/abuse controls: Resend free tier = 100 emails/day, 3k/mo (recipients count individually),
plus a **10 requests/second** API rate limit — so bulk-assign of 250 needs a queue twice over
(daily cap AND rps). Send via the `jobs` ledger (kind `training_email_batch`): throttle ≤2
req/s, use Resend's Batch API (up to 100 emails/request) for big waves, handle 429 with
retry-after, stay ~80/day headroom-aware, surface progress in the assignment board.
Per-assignment resend cooldown 60 s. All sends logged to `training_events`.

## 14. Security checklist (verify every box in Phase 6 review)

- [ ] Tokens: 256-bit random, base64url, stored ONLY as sha256; constant-time compare not needed
      (hash lookup), but rate-limit lookups; links revoked on completion/resend/revoke.
- [ ] Single-use enforced atomically (`used_at IS NULL` guard in the consume UPDATE — verify the
      second concurrent exchange gets 410, not a duplicate session).
- [ ] Refresh rotation + reuse detection: replaying a rotated token revokes the session and
      writes `session_reuse_detected`; one active device session per assignment (partial unique
      index) — test both.
- [ ] request-new sends ONLY to the stored `email_to` — never to caller input; 3/day cap.
- [ ] Interstitial POST exchange (scanner-proof); GET endpoints side-effect-free.
- [ ] R8 anti-copy, stated honestly: the watermark deters SCREEN-CAPTURE only — anyone can pull
      a clean MP4 from the network tab during the 15-min URL window; that residual risk is
      accepted for v1 (true source-traceable delivery needs tokenized HLS via the §6.4 provider
      swap). Verify: watermark renders in theater/container fullscreen; iPhone integrity mode
      never enters native fullscreen; nodownload/no-PiP set; signed URLs short-TTL (15 min) and
      never in list responses.
- [ ] Immutability incl. TRUNCATE: UPDATE/DELETE/TRUNCATE all raise on `training_events` even as
      service_role; DELETE/TRUNCATE revoked on attempts/quiz_attempts/certificates/versions.
- [ ] JWT rigor: `algorithms:['HS256']` pinned in both verifiers; principal decided by which
      secret verifies, never by token claims; `TRAINING_JWT_SECRET` ≠ Supabase JWT secret
      (startup assertion).
- [ ] Wall-clock integrity: `watch_seconds` accrues from SERVER timestamps only (E2b); ranges
      bounds-checked; client `elapsed_s` never trusted.
- [ ] Durable rate limits (Postgres-backed) on request-new + failed-token lookups; survive
      deploys and multiple instances.
- [ ] IDOR sweep: every learner route resolves the assignment from the PRINCIPAL, not from
      params (link principal: param mismatch ⇒ 404; app principal: ownership-checked).
- [ ] Session JWTs: HS256 `TRAINING_JWT_SECRET` (≥32 random bytes, distinct from every other
      secret), 4h TTL, scope = single assignment; middleware rejects Supabase JWTs on link-only
      paths and vice versa (no confused-deputy).
- [ ] All learner writes validate state transitions server-side (E1–E9); grading data never in
      client payloads (R6) — verify by inspecting network tab.
- [ ] Org scoping: every admin route ownership-checks `:id` vs JWT org (B5); every learner route
      scopes to resolved assignment; RLS denies cross-org reads (test in `supabase/tests`).
- [ ] `training_events` immutable (trigger + revokes) — test that UPDATE fails even as service_role.
- [ ] Signed video/cert URLs: video TTL 15 min, cert TTL ≤ 24 h, minted only after entitlement
      check; bucket private; no
      object paths leak in API responses (only via mint endpoints).
- [ ] Rate limits on exchange/preview; generic error messages (no token-exists oracle).
- [ ] Upload: bucket-level `file_size_limit` + `allowed_mime_types` set on `training-videos`
      (client-side checks are advisory — the browser talks straight to Storage); project Global
      file size limit raised; paths server-constructed (`<org_id>/<video_id>/…`) — client never
      supplies a path; mint/transcode assert org-prefix on every path read from the DB.
- [ ] No PII in URLs except the opaque token; no driver names in email subject lines.
- [ ] Zod-validate every request body/query; JSONB fields validated before insert.
- [ ] `pnpm lint`, `lint:boundaries`, `lint:filesize`, `typecheck`, `test` all green.

---

## 15. New environment variables (add to `apps/api/src/env.ts` with these defaults)

| Var | Default | Purpose |
|-----|---------|---------|
| `TRAINING_JWT_SECRET` | (required in prod; dev fallback random-per-boot) | Signs learner session JWTs (§7.1) |
| `TRAINING_LINK_TTL_DAYS` | `14` | Email link validity (§7.2) |
| `TRAINING_SESSION_TTL_HOURS` | `4` | Session JWT validity |
| `TRAINING_SIGNED_URL_TTL_MINUTES` | `15` | Video signed URL TTL — short: signed URLs are shareable bearer links; §12.5 re-mints silently |
| `TRAINING_MAX_UPLOAD_MB` | `200` | Upload size cap |
| `TRAINING_MAX_MONTHLY_EGRESS_GB` | `100` | Per-org delivery budget (§6.5) |
| `TRAINING_MAX_MONTHLY_EGRESS_GB_GLOBAL` | `180` | Account-wide budget across all orgs (§6.5) |
| `TRAINING_EXPIRE_GRACE_DAYS` | `30` | Days past due_at before an assignment lazily expires (E9) |
| `TRAINING_VIDEO_PROVIDER` | `supabase` | Provider switch (§6.4): `supabase` (later: `bunny`, `cloudflare`) |
| `TRAINING_TRANSCODE_CRF` | `28` | x264 quality (lower = bigger/better; 26–30 sane range) |
| `TRAINING_TRANSCODE_MAX_HEIGHT` | `1080` | Cap resolution; never upscales |
| `TRAINING_TRANSCODE_MAX_FPS` | `15` | Frame-rate cap — ideal for screencasts; raise for motion footage |
| `TRAINING_REFRESH_TTL_DAYS` | `30` | Device-session refresh token lifetime (§7.2) |

Plus the Railway service config: `NIXPACKS_PKGS=ffmpeg` on the api service (§6.3) — or
`RAILPACK_DEPLOY_APT_PACKAGES=ffmpeg` if the service is ever moved to the Railpack builder.
Startup assertions: `TRAINING_JWT_SECRET` present in prod AND ≠ the Supabase JWT secret.

Web needs no new env (public link page uses the existing `VITE_API_URL`). Email links are built
from the existing `env.WEB_APP_URL` (same as the invite flow: `routes/invites.ts` builds
`${env.WEB_APP_URL}/accept-invite`) — training uses `${env.WEB_APP_URL}/t/<token>`.

---

## 16. Implementation phases — the contract for future sessions

> Work strictly in order. Each phase lists: files touched, tasks, and ACCEPTANCE criteria.
> Definition of done for every phase additionally includes: `pnpm typecheck && pnpm lint &&
> pnpm test` green, migration applied cleanly to a fresh local db (`supabase db reset`), and the
> §0 tracker updated.

### Phase 0 — Groundwork (small)
**Files:** `packages/shared/src/training.ts` (new), `apps/api/src/env.ts`,
`apps/api/src/services/training/videoDelivery.ts` (new), Supabase dashboard (buckets).
**Tasks:** create private buckets `training-videos` + `training-certs` WITH bucket-level
`file_size_limit` + `allowed_mime_types` (§4.8) and raise the project Global file size limit to
≥ `TRAINING_MAX_UPLOAD_MB`; set `NIXPACKS_PKGS=ffmpeg` on the api service; add env vars (§15)
with Zod parsing like existing ones; define shared enums/types/Zod schemas (rules schema §5.3,
content snapshot schema, API DTOs); implement `supabaseStorageProvider` + unit tests (mock
supabase).
**Accept:** provider unit tests pass; env validation rejects missing prod secret; buckets exist &
are private (anon signed-URL fetch of a test object fails without mint); `ffmpeg -version` and
`ffprobe -version` succeed inside the deployed api service (NIXPACKS_PKGS set).

### Phase 1 — Schema (migrations 0079–0081)
**Files:** `supabase/migrations/0079_training_core.sql`, `0080_training_rls.sql`,
`0081_training_audit.sql`, plus training cases added to `supabase/tests/rls.test.mjs` (the
existing PGlite-based offline RLS matrix — extend it, don't create a parallel harness).
**Tasks:** exactly §4. Keep enum creation in 0079 only; policies text-compare roles (house
rule). Harness notes: PGlite must pre-create `anon`/`authenticated`/`service_role` (service_role
WITH BYPASSRLS, to faithfully prove that triggers/revokes — not RLS — are what block it) plus a
stub `auth` schema before applying migrations; storage-bucket behavior is NOT testable in PGlite
(covered by Phase 0 manual checks) — don't attempt it.
**Accept:** fresh `db reset` clean; `node supabase/tests/rls.test.mjs` proves: cross-org SELECT denied; driver-role user
sees own assignment rows only; authoring INSERT denied for `dispatcher`/`auditor`/`driver`;
`training_events` UPDATE/DELETE **and TRUNCATE** raise even as service_role (BYPASSRLS);
DELETE/TRUNCATE revoked on the other compliance tables; unique indexes enforce one-active-
attempt, one-active-assignment, and one-active-device-session.

### Phase 2 — Admin authoring (API + UI)
**Files:** `apps/api/src/routes/training/adminCourses.ts`, `adminVideos.ts`; services
`training/courses.ts`, `training/publish.ts`, `training/transcode.ts` (+ tests); web
`features/training/builder/*`, `TrainingCoursesPage.vue`, `TrainingCourseBuilderPage.vue`;
router + nav entries.
**Tasks:** course/segment/question CRUD (draft only — reject edits when status='published' unless
creating new draft version), upload handshake §6.1 (+ optional WebVTT captions upload per video,
stored at `captions_path`), **transcode worker §6.3 (jobs-ledger queue, ffprobe duration, status
chips, retry-on-failure, raw cleanup)**, publish §4.3 with full validation, version history list.
**Accept:** e2e happy path by hand: create course → 2 segments → upload 2 videos → 3 questions
each → publish → version 1 visible, content JSONB complete & correct; editing after publish
creates draft state without touching v1; publish validation rejects segment lacking video/questions;
vitest covers publish snapshot builder + validators + transcode queue logic (ffmpeg invocation
mocked; arg-building and keep-smaller-file logic unit-tested). Manual: upload a ~100 MB raw
screen recording → status chips progress → BOTH renditions exist (`play_hd.mp4` a fraction of
raw, `play_low.mp4` smaller still), play instantly (faststart), raw object gone from the
bucket; publish blocked while `transcoding`.

### Phase 3 — Learner player + rules engine (in-app channel first)
**Files:** api `routes/training/learner.ts`, `services/training/engine.ts` (+ tests!),
`services/training/attempts.ts`; middleware `trainingAuth.ts` (JWT part can stub until Phase 4);
web `features/training/player/*`, `MyTrainingPage.vue`, `TrainingPlayerPage.vue`; router/nav.
**Tasks:** implement E1–E9 exactly; heartbeat merge (incl. `resume_position_s` + quiz-answer
autosave); quiz draw/shuffle/grade with mid-attempt resume (same served set + restored
selections); R2 rewatch reset; R3 course reset; quality param on the mint endpoint + §6.6
player behaviors (auto-pick, stall downswitch, toggle, prefetch, buffer indicator); the full
§12.5 player spec (integrity/free modes, keyboard + mobile gestures, Wake Lock, Media Session,
captions track, error recovery incl. silent URL re-mint); R8 watermark overlay; "Continue where
you left off" card; assignment creation (admin
`POST /assignments` minimal — board UI can lag to Phase 4); "My Training" list for logged-in
users. Build all screens to the §12.4 visual spec (mockup `training-player-mockup.html` is the
reference).
**Accept:** `engine.test.ts` covers: range merge math (overlaps, duplicates, cap, out-of-bounds
422), threshold gating incl. the SCALED wall-clock guard (E3) and server-clock accrual cap
(E2b), rewatch zeroing (E2c — ranges/pct/seconds/position all reset on must_rewatch), grade
correctness (single+multi select), R2 transition, R3 reset at exactly max attempts, E5 dedupe at
BOTH start (get-or-create) and submit (`submitted_at IS NULL` 409), E10 idempotent attempt
creation for both principals + 409 on unpublished course, E11 single-viewer revocation, E9
lazy expiry at due_at + grace, E7 completion + score calc, scope-limited attempt
(R4) skips out-of-scope segments; resume math (position restored, mid-quiz same question set +
selections). Manual: a driver-role login completes a 2-segment course in-app end-to-end; wrong
answers force rewatch; 3rd fail resets course; killing the tab mid-video and mid-quiz resumes
exactly (position / question + selections); throttling the network to Slow 3G in devtools
triggers data-saver and the next segment still starts instantly after the quiz (prefetch).

### Phase 4 — Email one-time links (Resend)
**Files:** api `routes/training/links.ts`, `services/training/links.ts`, `emails.ts`; middleware
JWT completion; web `TrainingLinkPage.vue` (+ public route), `AssignmentBoard.vue`,
`AssignDialog.vue`, `AssignmentDetail.vue`, api `adminAssignments.ts`.
**Tasks:** §7.2 single-use lifecycle (atomic consume, device sessions, refresh rotation +
reuse detection, self-service request-new), §8.2 endpoints, rate limits, interstitial page,
email templates + batch queue via `jobs`, resend/revoke UI, assignment board with progress.
**Accept:** link flow works logged-OUT in an incognito window on a phone; GET preview burns
nothing (curl the link 10× → still exchangeable); the SECOND POST exchange → 410 (incl. under
concurrency — two parallel exchanges yield exactly one session); refresh rotates and old-token
replay kills the session; request-new emails the original address only, revokes the old session, honors used AND expired
tokens inside the bounded window but refuses outside it, and its 3/day cap survives a process
restart (DB-backed); exchange after revoke/expiry → 410 with clean UI; completing the course revokes link +
session; bulk-assign 10 drivers queues emails and board shows statuses; Resend daily-cap
throttle proven by unit test on the queue math.

### Phase 5 — Compliance + certificates + reporting
**Files:** api `services/training/certificates.ts`, `adminReports.ts`; web
`features/training/reports/*`, `TrainingReportsPage.vue`, attest dialog in player.
**Tasks:** §10 attestation + PDF + completion email + cert re-mint endpoint; §11 dashboard +
CSV export; failure-escalation email toggle.
**Accept:** cert PDF renders with all fields incl. version + scope; attestation required before
cert; CSV export matches DB for a seeded dataset; question-hotspot report correct on seeded
wrong answers; auditor role sees reports read-only, cannot author.

### Phase 6 — Hardening & cost controls
**Files:** api `services/training/egress.ts`, misc.
**Tasks:** §6.5 budget enforcement (org + global) + banner + `training_egress_overrides`
endpoint; transcode crash-recovery boot sweep proven (kill mid-transcode → boots back to
`queued`, ledger unwedged); full §14 checklist audit; load sanity (250 simulated learners
minting URLs); docs: update `docs/00-PRODUCT-OVERVIEW.md`,
`03-ROADMAP.md`, add runbook notes to this file; seed data for local dev (`seed.sql` additions —
demo course with 2 segments).
**Accept:** every §14 box checked with evidence; egress 429 path exercised in a test; banner
shows at 80% (fixture); this doc's §0 tracker all ✅.

---

## 17. Explicit non-goals (v1)

No SCORM/xAPI import-export · no adaptive bitrate (one well-compressed MP4 per video — §6.3;
provider swap adds ABR if ever needed) · no DRM and no burned-in/forensic watermarking (the R8
overlay watermark IS in scope; pixel-burned per-viewer watermarks and encrypted delivery are
not — that's the §6.4 provider swap tier) · no webcam proctoring · no in-video interactive overlays · no auto-recurring
re-certification schedules (manual re-assign covers re-training; scheduler is a fast-follow) ·
no offline playback (mobile app concern, later) · no per-question timers.

## 18. Open questions (non-blocking; decide during the marked phase)

| Q | Decide by | Options |
|---|-----------|---------|
| ~~Supabase Pro vs provider swap for rollout egress~~ | — | **Resolved 2026-07-23: org is on Supabase Pro.** Provider swap (§6.4) stays as a cost lever if egress trends past ~150 GB/mo |
| Should completing training via email link require drivers WITHOUT logins to verify DOB/employee-id (extra identity factor on attest)? | Phase 5 | typed-name only (default) vs +employee_id check |
| Reminder cadence automation (currently manual button) | post-v1 | reuse digestScheduler pattern |
| Retrofit invite tokens to hashed-at-rest like training links | anytime | small hardening PR |

---

---

## 19. Verification log

**2026-07-23 — three-lens adversarial review (internal consistency · security · external
feasibility with web verification) completed. All confirmed findings are folded into the
sections above.** Highlights of what changed in response, so future sessions don't re-litigate:
rewatch now zeroes all watch tracking (E2c); wall-clock is server-measured (E2b); submit-side
dedupe added (E5); published-course editing semantics defined (§4.3); idempotent attempt
creation + unpublished-course guards (E10); lazy expiry model (E9); single-viewer rule (E11);
`training_videos` made service-role-write-only; TRUNCATE closed on the audit log (§4.6);
signed-URL TTL cut to 15 min and R8 reworded honestly (network-tab download is accepted residual
risk for v1); durable DB-backed rate limits for request-new/failed lookups; request-new bounded
window + iOS ITP note; refresh rotation grace window + sliding expiry; transcode switched to
one-invocation/two-outputs at `veryfast` with boot-sweep crash recovery and realistic (~1–3 min)
timing; Nixpacks-vs-Railpack ffmpeg env documented; bucket-level upload limits (client checks
advisory); Resend 10 rps + Batch API in the email queue; iPhone fullscreen replaced by theater
mode in integrity mode (native fullscreen would drop watermark + seek-lock); egress meter
deduped per (attempt, video, rendition)/24 h with an account-global budget added; quiz autosave
endpoint added; captions delivery path completed; per-subject `email_to` + reachability
validation on bulk assign.

Residual accepted risks (documented, not bugs): clean-file grab via network tab during the
15-min URL window (fix = provider swap); watched-ranges are good-faith telemetry (wall-clock
floor is the hard guarantee); email-channel identity rests on mailbox control pending open
question #2; localStorage refresh token is XSS-exfiltratable with a one-assignment blast radius.

*End of plan. Implementation sessions: start at §0, find the first unchecked phase, open §16 for
that phase, and follow it. When reality diverges from this doc, update the doc in the same PR.*
