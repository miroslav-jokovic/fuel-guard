# F21 audit — Ask AI

**Findings only.** Fixes are in `PLAN.md`. Measured 2026-10-08 on `origin/main` @ `0c9ac66` and the
production database (read-only). Finding IDs: **U** use, **N** numbers, **W** UI and wording,
**S** frontend structure, **A** architecture and API, **D** data feeds, **P** production readiness,
**C** cost.

---

## 0. The short answer

Ask AI is a 91-line page in front of a 465-line, fuel-only tool loop. It answers one question at a
time with no memory, no streaming and no way to act. It has been used **15 times, by 3 people, ever**
(first 07-02, last 09-23). Two of the last questions were week-over-week idling comparisons that its
tools cannot express. The pieces an enterprise assistant needs already exist elsewhere in the repo:
a section × role matrix, per-person grants, URL-addressable filters and module read functions. The
assistant uses almost none of them.

---

## 4.1 Real use and benefit

- **U1. Measured use is close to zero.** `audit_logs where action='ai.ask'`: 15 rows, 3 actors,
  07-02 → 09-23; 9 in the last 60 days. Since Q-SET15 (09-30) only the admin can reach it, and
  since Q-PR2 (10-06) it is hidden from the sidebar until it has a named first user.
- **U2. What people actually asked.** 6 of 15 were the canned example chip ("high or critical
  theft alerts"). The free-text ones were trend comparisons ("is idling lower in the last 2 weeks",
  "week by week in percentage"). `idling_summary` has no time buckets, so those answers could only
  be totals.
- **U3. No first user is named yet** for the rebuilt assistant (Q-PR3 still open for this feature).
- **Verdict:** rebuild. The fuel-only version is not worth polishing, but the request (an assistant
  per role, across the product) is a real product need that the platform can now support.

## 4.2 Numbers and precision

- **N1. Most answers are a second copy of a number.** Only `fuel_economics` and `spend_trend` call
  the shared definition (`getFleetMpg`, `getFleetMpgSeries`). The other 11 tools aggregate raw
  `admin.from(...)` reads (`apps/api/src/modules/insights/askData.ts:141-417`): spend totals, idle
  hours and cost, flagged-fill counts, declines, coverage. The M4 lesson ("an assistant loses a
  user's trust in one exchange", `askData.ts:148`) applies to every one of them.
- **N2. Window by instant, not by day.** `since = Date.now() - period*86400_000` (`askData.ts:301`).
  "Last 30 days" here is a rolling instant, while every page in the app uses calendar days in the
  org's zone. This is the "a calendar day is not an instant" trap.
- **N3. Idle cost and hours ignore the idle verdict layer.** `idling_summary` sums `idle_events`
  directly. The Idling page reads `readFleetIdleVerdict` (`modules/idle/fuelIdleVerdict.ts`), which
  refuses a figure when coverage is too low. The assistant gives a number where the page gives
  "unavailable".
- **N4. `fleet_roster` restates vehicle status.** It counts with its own `.in("status", ...)` filters
  (`askData.ts:405-416`) instead of the roster census.

## 4.3 UI/UX and wording

- **W1. One-shot form, not a conversation.** There is a textarea, an Ask button, 7 fixed chips and
  one answer box (`apps/web/src/pages/AskAiPage.vue`). A follow-up ("and last month?") loses
  everything. There is no history and no way to copy, retry or stop.
- **W2. Raw text answer.** The answer is shown with `whitespace-pre-wrap`. Markdown tables the model
  writes appear as pipes and dashes, and figures are not tied to the page they came from.
- **W3. No streaming.** The user waits for up to 6 model round-trips behind "Analyzing your data…"
  with no progress. Measured cost of that is unknown because latency is not logged (P2).
- **W4. Duplicate title.** A hand-built `<h1>` row sits above `PageHeader`
  (`AskAiPage.vue:51-58`), and the explainer text uses engineering wording ("pre-defined,
  org-scoped queries").
- **W5. Fixed examples, the same for every role.** The 7 example questions are fuel and theft
  questions, which a dispatcher or recruiter cannot use.
- **W6. Reachable only as a page.** There is no global entry point, keyboard shortcut or link from
  the page the user is on, so asking about the screen you are looking at means leaving it.
- **W7. No voice input.** No speech code exists anywhere in `apps/web` or `apps/driver`.

## 4.4 Frontend structure

- **S1.** Page 91 lines; no components or composables of its own. Nothing reusable for a global
  panel.
- **S2. No overlay fits a non-modal assistant.** The only overlays are `SlideOver.vue` (modal, scrim)
  and `ui/BaseModal.vue` (`apps/web/src/components`). The design contract §6 says never to build a
  bespoke overlay, and it has no rule for a panel that stays open while the user works the page
  behind it. `packages/ui` exports no dialog or drawer.
- **S3. Filters live in the URL on most list pages, but their schemas live in the web app.**
  `useQueryState` / `useUrlSort` back `/drivers`, `/fuel-log`, `/anomalies`, `/fuel-cards`,
  `/findings`, `/fuel-spend`, `/ifta`, `/messages`, `/shop/inventory`, `/shop/units`. Each page
  declares its parameters in its own composable (for example `features/roster/useRosterFilters.ts`).
  No contract in `packages/shared` says which parameters a page accepts.
- **S4. `/dispatch/loads`, `/vehicles` and the maintenance lists keep filters in local state.** A
  link cannot open them filtered.

## 4.5 Architecture and API

- **A1. Scope is the org, never the person.** `askData(admin, env, orgId, question)` receives no
  role or section claim. The route asks for `fuel: view` (`routes/ai.ts:26-30`), so the whole tool
  set is fuel-shaped. Widening the tools without passing the caller's sections would hand every
  holder of `fuel: view` the whole product.
- **A2. The matrix the assistant needs already exists.** `SECTION_ACCESS` and
  `resolveSectionAccess(role, section, claim)` (`packages/shared/src/auth.ts:138-184, 476`) plus the
  person's `sections` JWT claim (migrations 0291, 0299, hook in 0393) give the effective access per
  section. Its shipped defaults already match the owner's example: a dispatcher has
  `accounting: none, billing: none`. Nothing turns that into a per-request tool list.
- **A3. The surface gate is fuel's.** `{ key: "ask-ai", gate: section("fuel"), startsOnFor: [] }`
  (`packages/shared/src/surfaceCatalogue.ts:77`). A recruiter or technician without Fuel can never
  be granted the assistant, even after it covers their section.
- **A4. The tools bypass the modules that own the data.** 11 of 13 read other modules' tables
  directly from `insights`, and they are pinned for the P6.1 burn-down. The modules already export
  read functions an assistant can reuse: `getFleetReport`, `getIncomeStatement`
  (financial), `listLoads` / `getLoadDetail` (loads), `readLiveMapBoardCached` (livemap),
  `getComplianceOverview` (evidence), `readFleetIdleVerdict` (idle), `getDriverLeaderboard`
  (performance), `listInspections` / `listParts` (maintenance), `readIftaPeriod` (ifta),
  `loadInquiryQueue` (recruiting), `buildFuelSpendRollup` / `listExceptions` (fuel-spend),
  `readFleetIdentities` (roster).
- **A5. Models are a generation old.** `AI_MODELS = { fast: "claude-haiku-4-5", deep:
  "claude-sonnet-4-6" }` (`packages/shared/src/ai.ts:10`). The SDK is pinned at 0.107.0.
- **A6. No prompt caching, no streaming, no thinking control.** `messages.create` with `max_tokens:
  1024` (`askData.ts:446`). The tool list and system prompt are re-billed on every round.
- **A7. Tool results are not marked as data.** Results include text users and vendors typed: station
  names, driver names, import filenames. The system prompt does not say that text inside a tool
  result is never an instruction.
- **A8. No tests.** There is no `askData.test.ts` and no `expectOrgScoped` assertion for any tool.
- **A9. No action path.** The model can only read. There is no structured way to return "open this
  page with these filters" or "assign this finding", and no confirmation step.

## 4.6 Data feeds and jobs

- **D1.** The answers depend on the EFS, Samsara, McLeod and FleetPal collectors. No tool reports how
  fresh its data is, so a stale feed reads as a quiet week. The freshness signals exist (feed
  cursors, `readTelematicsCoverage`, McLeod sweep times) and are not passed to the model.

## 4.7 Production readiness

- **P1. Rate limit is per IP and shared.** `/api/ai` sits behind `strictLimiter` (30 per 15 min,
  keyed by IP, shared with `/api/auth`, `/api/reports`, `/api/integrations`; `apps/api/src/app.ts:380`).
  One office behind one IP shares 30 asks, and a sign-in storm eats the assistant's budget.
- **P2. Spend is invisible.** No usage is recorded for Ask AI or the digest. Only hazmat writes
  `org_usage_month`. `organizations.ai_monthly_token_budget` exists (0003) and is not enforced here.
- **P3. Errors are swallowed.** A tool error becomes `{ error: message }` handed to the model, and
  the model's failure surfaces as a 500 with no log line naming the tool.
- **P4. The audit row holds the question, not the answer or the tools used.** An admin cannot see
  what data an answer was built from.
- **P5. No retention rule** applies to questions (they sit in `audit_logs` forever).

## Cost

- **C1. Cost today is negligible because use is.** At the current model (Haiku 4.5, $1 / $5 per
  MTok), an uncached 3-round answer is about 3 × (2.5k tools + system + growing history) input and
  ~600 output, roughly **$0.01–0.02 per question**. There is no measurement (P2), so this is an
  estimate.
