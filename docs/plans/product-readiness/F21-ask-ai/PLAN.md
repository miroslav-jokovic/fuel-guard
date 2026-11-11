# F21 plan — the Silvicom assistant (Ask AI rebuilt)

**Status:** PROPOSED 2026-10-08. Nothing built. Waiting for the owner on Q-AI1..Q-AI9. Findings are
in `AUDIT.md` (IDs U, N, W, S, A, D, P, C).

**Goal (owner, 2026-10-08):** one assistant across the whole product. Each person sees only what
their role and grants allow, and the admin sees everything. It answers, filters, searches and later
acts. It takes voice, and it is reached from a modern floating launcher on every page. It must be
enterprise grade, cheap to run, and stay on the Anthropic API.

---

## 1. Decisions proposed (D-AI*)

- **D-AI1. Scope comes from the section claim, never from a list.** Every assistant tool declares
  exactly one `(section, level)`. Per request, the tool list is
  `TOOLS.filter(t => resolveSectionAccess(role, t.section, req.auth.sections) >= t.level)`. The
  model never sees a tool the caller cannot use, so it cannot call it, mention it, or be talked into
  it. Execution checks the same predicate again (defence in depth). Admin gets everything because
  the matrix says so (`admin` is not editable), with no special case. This answers "dispatch only
  sees dispatch" with the matrix the API and database already enforce (A1, A2). A per-role tool list
  written by hand would be the `session.canManage` workaround again.
- **D-AI2. Each module contributes its own tools.** `modules/<m>/assistantTools.ts`, exported through
  the module's `index.ts`, wraps the read functions that module's pages already use (A4). The new
  `assistant` module only composes them, so `lint:boundaries` holds and the assistant's number is
  the page's number by construction (N1). A tool that would need a new aggregate gets it built in
  the owning module first, with its page or test as the first caller.
- **D-AI3. Tool metadata is a shared contract.** `packages/shared/src/assistantContract.ts` holds
  the tool name, section, level, Zod input schema (to JSON schema, `strict: true`) and result
  envelope `{ data, source: { surfaceKey, href, window, asOf, freshness } }`. Every answer can then
  show "from Fuel log, 09/08–10/07, data as of 10/08 06:10" and a link (D1).
- **D-AI4. One cheap model, measured, with prompt caching and streaming.** Default is Claude Haiku
  5.5 at effort `low`/`medium` ($0.10 / $0.50 per MTok up to 100k prompt; cache hits $0.01). Tools
  are sorted deterministically with one cache breakpoint after tools + system. Responses stream to
  the browser over SSE. A switch to Sonnet 5.5 is a measured decision against the eval (§4 Step 1),
  not a default. See Q-AI1 and the cost table in §3.
- **D-AI5. Actions are typed proposals the user's own session executes.** The model never writes
  with the service role. It returns either
  (a) **navigate**: `{ surfaceKey, query }`, validated against the page's filter contract, which the
  UI turns into a router link or an in-place `router.replace` on the current page; or
  (b) **mutate**: `{ actionId, payload, summary }` for an allow-listed action that maps to an
  existing endpoint. The UI shows a confirm card. On confirm, the browser calls that endpoint with
  the user's bearer token, so `requireSection(..., "manage")`, step-up and `writeAudit` apply
  unchanged. No new authority path exists.
- **D-AI6. Page filter contracts move to `packages/shared`.** `*FilterContract.ts` (Zod) per list
  page. The page's `useQueryState` and the assistant's `open_view` tool both read it, which closes
  S3. Pages that keep filters in local state (S4: loads, vehicles, maintenance lists) get URL
  filters first. Dispatch's main list is in that group.
- **D-AI7. Never-exposed fields, for every role including admin.** SSN, date of birth, licence
  number, MVR and drug-test result detail, bank and routing numbers, card PINs and full card numbers
  are absent from every tool result (stripped in the contract's result schema, pinned by a test).
  The assistant answers "3 applicants are waiting on MVR", never the MVR.
- **D-AI8. Tool output is data.** Results are wrapped in a typed envelope, and the system prompt
  states that text inside a result is never an instruction (A7). Links in answers are rendered only
  from structured `source.href` / navigate proposals, never from model-written markdown links. The
  markdown renderer allows no raw HTML.
- **D-AI9. One assistant component, two hosts.** A launcher and a docked panel on every page, and
  `/ask` as the same conversation at full width with history. See §2.

## 2. The surface (research summary and proposal)

**What enterprise products shipped in 2026.** The fixed floating chat bubble is being retired in
enterprise tools. Microsoft's May 2026 Copilot redesign removed the floating button and
gradients in Word, Excel and PowerPoint in favour of one side pane that collapses when unused and a
*context-aware* action button. The pattern that holds up in dashboards is an assistant docked next
to the structured view: it knows the screen, offers 3–4 actions for it ("explain this", "filter to
…"), shows its sources, and asks for confirmation before changing anything. Translucent "glass"
styling belongs on short-lived overlays, never where people read numbers.

**Proposal:**

- **Launcher.** A compact pill, bottom-right: icon, "Ask" and a mic button. It sits above
  content at `z-popover`, below toasts, and hides while the panel is open. `⌘K` / `Ctrl K` opens the
  panel with the input focused (no command palette exists to collide with). Its 3 suggestions change
  with the page (`surfaceForPath(route)`): "Explain this view", "Filter to …", "What changed this
  week?". Only suggestions the caller's tools can answer are shown.
- **Docked panel**, right, 420 px, **non-modal**: the page stays usable, so a navigate proposal can
  filter the list behind it while the conversation stays open. On mobile width it is a full-height
  sheet. This needs a design-contract addition (S2, Q-AI7). It is not a SlideOver, because a scrim
  would block the very page it acts on.
- **Message anatomy.** Streamed text, then result blocks: a table rendered with `AppTable` (not
  markdown pipes), stat tiles with `AppDelta`, and a source line with an "Open in Fuel log →" link.
  Navigate proposals appear as one button ("Show these 12 in Findings"). Mutate proposals appear as
  a confirm card that names the change in plain words. Copy, retry and stop are always available.
  Thinking is not shown; between-tool progress appears as one muted line ("Reading fuel log…").
- **Voice.** Mic in the input. Hold or tap to talk, the transcript lands in the input to edit, and
  nothing sends without the user (unit numbers and names are where speech recognition fails). See
  Q-AI3 for the engine. Optional "read answer aloud" uses the browser's `speechSynthesis` (free).
- **Wording.** Plain words for an office user whose first language is not English. No "org-scoped
  queries". The empty state lists what *this person* can ask, derived from their tool list.

## 3. Cost (Anthropic list prices, 2026-10-08)

Assumed typical answer: ~12k tokens of tools + system (cached), 3 model rounds, ~4k uncached tokens
(question, history, tool results) and ~1.5k output including thinking.

| Model | Per answer | 10k answers / month |
|---|---|---|
| Haiku 5.5 ($0.10 / $0.50; cache hit $0.01) | ≈ $0.002 | ≈ $20 |
| Sonnet 5.5 ($2 / $10; cache hit $0.10) | ≈ $0.03 | ≈ $300 |
| Opus 5.5 ($4 / $20; cache hit $0.20) | ≈ $0.06 | ≈ $600 |

Speech: browser engine $0. A server engine (Deepgram or AssemblyAI streaming) costs
$0.0025–0.0077 per minute, about $4–12 a month at 50 users × 5 min, plus a new vendor and DPA.
These are estimates. Step 1 records real usage per answer, and the plan is re-priced after a week
of measured use.

Guards: per-org monthly token budget (enforce `organizations.ai_monthly_token_budget`, which
exists and is unused); per-user limiter (keyed by user, not IP: P1); 8-round cap per answer; history
trimmed to the last N turns plus a running summary once a conversation passes ~30k tokens.

## 4. Steps (small PRs; each has an acceptance check)

**Step 0 — rulings.** Q-AI1..Q-AI9 answered. Named first user per role (Q-AI8).

**Step 1 — measure and protect (no UI change).**
- 1a. Migration: `ai_usage` (org, user, conversation, model, input/cache-read/cache-write/output
  tokens, cost micro-dollars, latency ms, tools called, outcome), RLS on, deny-all. Writer is one
  function; `[ai]` log line per answer. *Accept:* staging shows a row per ask with cost.
- 1b. Per-user limiter for `/api/ai` (own limiter, not `strictLimiter`) + monthly org budget
  check → 429 `ai_budget_exhausted` with a plain message. *Accept:* tests at the boundary.
- 1c. Eval set: the 15 real questions + 10 per section, each with the expected tool(s) and the
  page number it must equal. Runs on demand (costs money), not in CI. *Accept:* baseline score
  recorded for Haiku 4.5 (today) and Haiku 5.5.

**Step 2 — the engine (still the old page).**
- 2a. `packages/shared/src/assistantContract.ts` + the role filter (D-AI1, D-AI3). *Accept:* a test
  derives, for every role × shipped defaults, the tool list from `SECTION_ACCESS` and asserts no
  tool outside the role's sections; mutation of the predicate fails it.
- 2b. `modules/assistant` (new; ARCHITECTURE.md entry; owns `ai_usage`, `ai_conversations`,
  `ai_messages`). Loop on Haiku 5.5, caching, `strict` tools, typed SDK errors, refusal and
  `max_tokens` stop reasons handled. Port the 13 tools onto module read functions (N1–N4, A4),
  fixing the window to calendar days in the org zone. *Accept:* each tool's figure equals its page's
  figure in a test; `expectOrgScoped` on every tool.
- 2c. Surface gate: `ask-ai` stops being fuel's (A3). It gates on staff membership plus "has at
  least one tool", with `startsOnFor` from Q-AI2. *Accept:* `namedGrantGates.test.ts` updated; a
  recruiter granted the surface sees only recruitment tools.
- 2d. SSE endpoint `POST /api/ai/conversations/:id/messages` (fetch + reader on the web; bearer
  header, so not `EventSource`). Check the `compression` middleware and Railway's proxy do not
  buffer the stream. *Accept:* first token under 2 s on staging, measured.

**Step 3 — the surface.**
- 3a. Design-contract addition for the non-modal dock (Q-AI7) + `AssistantDock`, `AssistantLauncher`,
  `AssistantThread` under `src/features/assistant/`; `/ask` hosts the same thread full width with a
  history list. *Accept:* keyboard only, 390 px width, reduced motion, loading, empty, error,
  budget-exhausted and no-permission states; `e2e-apply`-style stubbed spec.
- 3b. Conversations persisted (Q-AI4 retention), private to their author.
- 3c. Voice input (Q-AI3). *Accept:* hidden where unsupported; transcript editable before send.

**Step 4 — breadth, one section per PR** (each adds that module's `assistantTools.ts`, eval cases,
and its named user's task walk):
dispatch (loads, live map, assignments, HOS) → safety (idle verdict, driver scores, compliance/DQ
status, findings) → roster and equipment → maintenance (inspections, parts, FleetPal units/work
orders) → recruitment (pipeline counts, screening readiness; D-AI7 applies) → accounting and billing
(fleet report, income statement, invoices) → hazmat → IFTA. Every tool returns `source.freshness`
from its collector (D1).

**Step 5 — navigate actions.** Filter contracts to shared (D-AI6), starting with
`/findings`, `/fuel-log`, `/anomalies`, `/fuel-cards`, `/drivers`, then URL filters for
`/dispatch/loads` and `/vehicles`. `open_view` tool + current-page context. *Accept:* "show me open
findings over $200 for unit 718" filters the page behind the dock; an invalid parameter is refused
by the contract, not silently dropped.

**Step 6 — confirmed write actions** (list from Q-AI6). Each action is one allow-list entry → one
existing endpoint. *Accept:* the action fails with the user's own 403 when they lack `manage`; the
audit row is the endpoint's own.

## 5. Open questions for the owner

- **Q-AI1. Model and monthly cap.** (a) Haiku 5.5 everywhere, measured; (b) Sonnet 5.5 everywhere
  (~15× cost); (c) Haiku 5.5, escalating one answer to Sonnet 5.5 only when the eval shows a class of
  question Haiku fails. **Recommend (a) now, (c) only on evidence.** Cap: $50 per org per month to
  start, with an admin alert at 80%.
- **Q-AI2. Which roles start ON** (`startsOnFor`; admin always on). Recommend fleet_manager,
  dispatcher, safety_manager, accountant. Recruiter and technician once their sections have tools
  (Step 4). Auditor off. Driver never.
- **Q-AI3. Voice engine.** (a) Browser speech recognition: free and instant, but audio goes to
  Google (Chrome/Edge) or Apple (Safari), Firefox is off by default, and there is no custom vocabulary;
  (b) server speech-to-text (Deepgram or AssemblyAI, ~$0.003–0.008/min): every browser, keyterms for
  unit numbers, but a new vendor and DPA. **Recommend (a) first, with Chrome's on-device mode where
  available, and (b) only if unit numbers are misheard in the task walk.**
- **Q-AI4. Conversation retention and visibility.** Recommend 90 days, visible only to the author,
  with `ai_usage` (no text) kept for 13 months for cost. The `ai.ask` audit row keeps the question.
  - **Ruled 2026-11-11 (owner approved the R4b handoff's recommendations):**
    - (a) `ai_assistant_usage` (0584, tokens and cost, no text) gets a 13-month retention rule, which
      covers the year-over-year cost view.
    - (b) The `ai.ask` row in `audit_logs` stays as it is, kept forever with the rest of
      `RETENTION_FORBIDDEN`: it is the compliance record of who asked what with which access, its
      answer comes from data the person was entitled to with D-AI7 fields already stripped, and the
      volume is trivial (21 rows, 2.6 KB of meta, measured 2026-11-11).
    - (c) Conversations stay tab-local (Pinia; a reload starts empty). R3b stays unbuilt until somebody
      asks for it; if it is built, the 90 days, author-only, RLS deny-all, API-only shape above holds.
- **Q-AI5. Never-exposed fields (D-AI7).** Confirm the list, and confirm it applies to the admin too.
  Recommend yes: the assistant is the wrong door for those fields even for someone allowed to see
  them on the page.
- **Q-AI6. First write actions.** Candidates: assign a finding, close/dismiss with reason, message
  a driver, add a card override, create a saved view. Recommend assign + saved view first
  (reversible, low stakes); card overrides last.
- **Q-AI7. The dock.** Accept a non-modal docked panel as a new pattern in
  `DESIGN-SYSTEM-CONTRACT.md` §6? Recommend yes. A SlideOver's scrim blocks the page the assistant
  filters.
- **Q-AI8. Named first users.** One person per role for the Step 3/4 task walks (Q-PR3). Q-PR2 hid
  Ask AI until it has one.
- **Q-AI9. Data handling.** Questions and tool results go to Anthropic (commercial API terms; no
  training on API data). Does any carrier contract require zero data retention or US-only inference
  (`inference_geo: "us"`, +10% cost)? Recommend standard global unless a contract says otherwise.

- **Q-AI10. The finance routes' `to` is two things at once (found at R6a, 2026-11-10).**
  `windowSchema` documents `to` as EXCLUSIVE, and the sub-ledger reads behind `getFleetReport`
  (settlements, voids, bills, deductions) window on `.lt(to)`. But `readLedgerForPeriod` and
  `coveredMonths` widen with `nextMonthStart(to)`, which treats `to` as a day INSIDE the last month,
  and the Fleet report page sends the last day (`2026-10-31` for October). Its comment says "the query
  layer converts the end to the API's exclusive bound", but no finance hook does since 7bb6159
  (2026-09-04) deleted `useCpm`, the one that did. Commit 0847cca fixed this same bug once on 08-28.
  Effect: the ledger money is right (month-grained); the contractor split, the Trucks tab's loads and
  revenue, and the Activity tab (all from bills and settlements) lose each period's LAST DAY. The company column absorbs
  the difference (it is the remainder), so totals still tie. Sending an exclusive `to` from the web
  alone would be worse: the ledger would add the next whole month. Candidates: (a) the routes take an
  inclusive `to` and `getFleetReport`/`getBillingActivity` pass `exclusiveEndYmd(to)` to the
  sub-ledger readers; (b) the routes take exclusive `to` and the ledger side widens from `to - 1 day`,
  with the web hooks calling `exclusiveEnd`. **Recommend (a):** every caller already sends inclusive
  days, and it is one change in two services plus `windowSchema`'s comment and a `from === to` rule.
  Changes published figures (contractor column, Trucks tab), so it is its own PR with before/after
  numbers for one month. The assistant's finance tools call `getFleetReport` with the page's own
  arguments, so they move with the page.
  - **Ruled 2026-11-10 (owner: "proceed … with solutions in flow with what we are building"): (b),
    reversing the (a) recommendation above.** Measuring the callers settled it: `windowSchema`,
    `truckDays`, `reads.ts` (`/summary`, `/spend-by-account`, `/entries`), `/api/billing`'s dispatcher
    earnings and every sub-ledger reader are already half-open, and so is the web's own `dateWindow`
    rule from 0847cca (inclusive in page state, `exclusiveEnd` once at the API boundary). Only the
    month-widening (`readLedgerForPeriod`, `coveredMonths`, mileage coverage, the statement's
    previous-period read) and the four hooks that lost `exclusiveEnd` at 7bb6159 were off-contract.
    (a) would have left two contracts across the finance routers. Measured in production on
    2026-11-10, the last day carried 48/72/94/62 booked bills ($159,107 / $230,666 / $469,106 /
    $189,110, 3.0–8.7% of revenue) and 99/135/162/95 settlements, June to September.
- **Q-AI11. The auditor gets the finance tools.** Q-AI5 was ruled on "the matrix gives
  `accounting` to admin and accountant only". It also gives the read-only `auditor` VIEW of
  `accounting` (and of every section), so the auditor can open `/fleet-report` today and, once Ask AI
  is turned on for auditors, gets `finance_report` and `income_statement`. R6a follows the matrix
  (no role list). If auditors should not see finance, the change is the auditor's `accounting` access
  in the matrix, which hides the page too, never an assistant exception. **Recommend: keep.** An
  auditor reads everything by design, and Ask AI is still off for that role (`startsOnFor: []`).
  - **Ruled 2026-11-10: keep** (owner: proceed with the recommended solutions).
- **Q-AI12. Fuel costs is gated `manage("fuel")`, but its report route answers `view` (found at R4a,
  2026-11-10).** The surface `fuel.spend` (`/fuel-spend`) asks `manage("fuel")`, while
  `GET /api/fuel-spend/report` asks `requireSection("fuel", "view")`. `fuel_report` follows the route
  (D-AI1: a tool declares its route's gates), so a fuel VIEWER (dispatcher, accountant by default) gets
  Fuel costs figures from Ask AI on a page they cannot open. R4a draws no link for them
  (`canReachSurface`), but the figure is still theirs. Candidates: (a) the route asks `manage`,
  matching the page, so the tool follows; (b) the page opens to `view`, matching the route; (c) keep
  both as they are and write down why. **Recommend (b):** the report is a read, every other fuel page
  is `section("fuel")` (view), and the route was written as a view on purpose; `manage` on the page
  looks inherited from the old Fuel Spend tabs that held writes (FS2). It changes who sees a sidebar
  entry, so it is the owner's call.
  - **Ruled 2026-11-11: (b)** (owner approved the R4b handoff's recommendations). History confirmed the
    premise: FUEL-SECTION-CONSOLIDATION T2 (PR #446, 2026-09-01) moved every fuel-spend READ route to
    `view` on purpose ("an accountant … can generate the spend report"), so the route is the later,
    explicit decision and the page the stale half. Buy discipline (`fuel.spend.buy-discipline`) opens
    with it: it holds no write. Dispatchers get the page too, as the matrix already gives them the
    report. Recorded, not built: had the owner not wanted dispatchers on fuel spend (D-SEP10's old
    note), the fix would be the dispatcher's `fuel` cell in the matrix, narrowing routes, page and tool
    together — never the page or the tool alone.

## 6. Log

- 2026-10-08 — Audit and plan written. Use measured (15 asks, 3 people, ever). Research:
  enterprise assistant patterns, browser speech support, STT and Claude pricing.
- 2026-11-10 — **Reporting track R1–R7, R1 built.** The owner asked on 11/09 for "mpg on my units 748
  751 762 763 784 785 786 787 788 … for a month or Q", and no tool could answer it: `fuel_ranking` takes
  no unit list and caps at 25 rows, its MPG is each subject's fill-to-fill figure rather than D-MPG1's,
  and every window was N days back from this instant in UTC (N2). Measured use is now 20 asks, 3 people;
  the unanswerable ones were the nine units, "cost per mile" (09/23, 11/02), "how many drivers are
  moving" and week-over-week idling (07/29, 08/04).
  - **R1 (this PR):** a `fuel_report` tool owned by fuel-spend (`assistantFuelReport.ts`, D-AI2's
    shape) that is the Fuel Costs report asked in words — up to 25 named units, calendar periods on
    the carrier's clock (this/last month, this/last quarter, year to date, last year, last N days, or
    from/to), one row per truck or per month, the previous period of equal length. Every figure is
    `readFuelReport`'s, so it equals the Fuel Costs page by construction; `readFuelReport` gained
    `{ trailing, sites }` options that skip what the tool does not print. The model is told today's
    date in the org zone. The `ai.ask` audit row now keeps the answer (4,000 chars) and each tool
    call with its input and any error (P3/P4). `max_tokens` 1,024 → 2,048. Tool schemas moved to
    `askTools.ts` (file budget).
  - **Still open, in order:** R2 = Step 1 (usage table, per-user limiter, cap, Haiku 5.5 — needs
    Q-AI1); R3 = history (Step 2d/3b); R4 = CSV/PDF and "open in Fuel Costs" from an answer (needs a
    URL filter contract for `/fuel-spend`, D-AI6); R5 = the role filter D-AI1–3, **a precondition for
    any non-fuel tool**; R6 = breadth per section (finance cost per mile beyond fuel, idle trend, live
    "moving now", loads/miles per truck, IFTA by state, maintenance cost per unit, card holds, DQ and
    inspection expiries, recruiting counts); R7 = the eval set from the 20 real asks (Step 1c).
  - R1 does not answer "cost per mile" in full: `fuel_cost_per_mile` is fuel only, and the tool says
    so. All-in cost per mile is the finance fleet report's (R6, behind R5, and it lags the GL close).
- 2026-11-10 — **Q-AI1 ruled, R2 built.** The owner said "analyze and proceed with R2" on the
  recommendation as written: **(a) Haiku 5.5, $50 per carrier per month, admin alert at 80%.**
  - **Model and request:** `AI_MODELS.assistant = "claude-haiku-5-5"` (its own key; `fast` stays Haiku
    4.5 for the verification layer and readers, which move on their own measurements). Effort `low`,
    `max_tokens` 8,000 (Haiku 5.5's thinking counts toward it). Tools and the fixed system prompt are
    cached; today's date is a second system block after the breakpoint; top-level `cache_control`
    lets each round re-read the last. `refusal`, `max_tokens`, a six-round stop and a thrown model
    error each end as their own outcome; a failed tool goes back with `is_error`.
  - **Meter (0584):** `ai_assistant_usage`, one row per answer — tokens by kind, list-price cost in
    micro-dollars (`requestCostMicroUsd`, shared), rounds, latency, tools, outcome, no text — written
    only by `record_assistant_answer`, which adds every token to `org_usage_month` in the same call
    (the fourth writer, after 0130/0451/0549). An `[ai]` log line per answer, counts only.
  - **Gate:** before the model is reached, the carrier's existing "Monthly AI usage limit, in tokens"
    (`anomaly_thresholds.ai_monthly_token_budget`, enforced by nothing until now; no carrier has set
    one) against `org_usage_month`, then the $50 cap against this month's ledger on the carrier's
    clock → 429 `ai_budget_exhausted` with a plain sentence. Fails open, logged, if the meter cannot
    be read. Per-person limiter, 30 per 15 minutes keyed on the caller (`assistantLimiter`), in place
    of the per-address `strictLimiter` the whole office shared (P1).
  - **Not yet (R2b):** the 80% alert's SENDER. 0584 adds the bell category `ai_assistant_budget`
    and the contract entry; the code that rings it is the next merge after this one reaches
    production (lint:migration-ordering's CHECK-before-writer rule, as 0563/0575).
  - Q-AI4 (retention) is still open, so `ai_assistant_usage` declares no retention rule.
- 2026-11-10 — **R2b built: the 80% and 100% bells.** `alertAssistantBudget` (insights) runs after
  each recorded answer with the month's spend the gate read and the answer's cost; `assistantCapCrossings`
  (shared) rings `warn` on the answer that carries the month past $40 and `reached` on the one past
  $50 — crossing, not "is above", with a dedupe key per line per carrier per month on the carrier's
  clock, so a line rings once. Recipients are `usersWhoManage(…, "admin")`, the section matrix's
  answer, never a role list. The bell opens `/ask`. It never throws; a failure is logged.
  - **Correction to R2's entry:** R2b did not have to wait for 0584 in production. A release applies
    migrations BEFORE code, and staging had 0584 at R2's merge, so the CHECK always precedes its writer.
  - **Open, not a blocker:** the $50 cap is a constant (`ASSISTANT_MONTHLY_CAP_MICRO_USD`); no screen
    lets an admin raise it. The carrier's own token limit (Thresholds) is the knob they have. A per-org
    cap setting is a later decision if a carrier needs more than $50 of Ask AI a month.
- 2026-11-10 — **Q-AI2 and Q-AI5 ruled; R5 built (D-AI1, D-AI3, D-AI7).**
  - **Q-AI2 (owner):** "all roles will get it eventually but AI will be related to their features and
    they will not be able to see whatever they want." → D-AI1 as proposed: tools derived per request
    from the section matrix. Roles are turned on as their areas get tools (Q-SET15's per-role switch
    stays; nothing turned on by this change).
  - **Q-AI5 (owner):** "Admin and Accounting can see financial data only, others need to see what is
    already regulated by permissions." → no separate assistant permission list; the matrix already
    gives `accounting`/`billing` to admin and accountant only, so a finance tool declaring
    `accounting: view` reaches exactly them. **Plus D-AI7's narrow list** (owner: "proceed as proposed
    and recommended"): SSN/tax id, date of birth, licence/CDL number, bank account and routing
    numbers, full card numbers and PINs, passwords/keys/tokens — stripped from every tool result for
    every role, admin included, because a report never needs them and tool results go to the model
    provider. Names, statuses, counts and last-4s stay.
  - **Built:** `packages/shared/src/assistantContract.ts` — each tool's section(s), taken from the gate
    of the page its figure comes from (fuel tools → fuel; idling and driver scores → safety, as
    `/api/idle` and the Driver performance page gate; fleet size → roster AND equipment);
    `assistantToolsFor(role, sections)`; `stripNeverExposed`. The model is shown only the caller's
    tools; the API refuses a call outside them; every result is stripped. The endpoint drops Q-SET14
    (b)'s `requireSection("fuel")`; `ask-ai` becomes a STAFF screen that still starts off
    (`startsOnFor: []`); someone with no tool is refused (`ai_no_tools`) and never shown the launcher;
    suggestions name their tool and show only answerable ones. The system prompt no longer lists
    areas the person may not have.
  - **Today's tool reach (shipped defaults, computed from `assistantToolsFor`):** admin, fleet
    manager, safety manager and auditor 14 of 14; dispatcher 12 (no idling, no driver scores);
    accountant 11 (the fuel tools only); recruiter, technician and driver none yet. Org overrides move
    these per carrier, and the screen itself is still off for every role but admin until turned on.
  - **Next (R6):** finance first (`accounting: view` → admin + accountant), each tool calling its page's
    own function with a test that the numbers agree, and a `source` line with freshness.
- 2026-11-10 — **R6a built: finance tools (`finance_report`, `income_statement`).**
  - **Owner module (D-AI2):** `financial/assistantFinanceReport.ts`. `finance_report` is
    `getFleetReport`, the function behind `/api/accounting/fleet-report`. It gives the all-in revenue,
    expense, net and per-measured-mile figures; company trucks versus owner-operators; empty miles;
    expense and revenue families; by=truck (named units or the top by revenue: loads, miles, revenue,
    revenue per mile, and a stated "no per-truck cost", D-FLEET1, P3 unbuilt); by=contractor; and
    by=month (one page read per month, at most 12). `income_statement` is `getIncomeStatement`, with
    `compare` previous (default), ytd or none, and section totals or every account line. Nothing is
    recomputed: a mutant that divides expenses by miles is killed by the test.
  - **Calendar:** periods are whole months on the carrier's clock, asked exactly as the page asks
    (`from` = 1st, `to` = last day of the last month; see Q-AI10). `last_n_days` is not offered
    because the ledger has no day grain; a custom range is widened and the label says so. R1's calendar
    moved to `@silvicom/shared` `assistantPeriods.ts` so fuel and finance resolve "last quarter" one way.
  - **Provenance on every answer:** months in the figures, not swept, left out (with `ledgerMonthWhy`'s
    reason), still open in McLeod (with `openNote`), whether McLeod's close is known, and when the
    McLeod finance sweep last landed (or that it never has). The tool description tells the model to
    state them and never to call an open month final.
  - **Access:** both tools declare `accounting: view`. The matrix gives that to admin, accountant and
    the read-only auditor (Q-AI11); every other role is refused by `assistantToolsFor` and the API.
    Suggestions on `finance.fleet-report` name their tool. New boundary edge `insights -> financial`.
  - **Tests:** `assistantFinanceReport.test.ts` (the page's windows, figures copied, provenance, org
    scope, late-evening clock), contract and suggestion tests by role. Six deliberate breaks
    (exclusive `to`, recomputed cost per mile, dropped sync date, unscoped org lookup, dropped open
    months, finance gated on fuel), each killed and restored.
  - **Next:** R6b in the handoff's order (idle trend, moving now, loads and miles per truck, IFTA by
    state, maintenance cost per unit, card holds, DQ and inspection expiries, recruiting counts).
- 2026-11-10 — **R6b first item built: `idle_report` (safety).** Week-over-week idling (asked 07/29,
  08/04) is the Idling page's own verdict: `idle/assistantIdleReport.ts` calls `readFleetIdleVerdict`
  (the page's three reads, its cost basis, and `computeIdleBreakdown`) once per window. That means the
  period, the previous period of equal length, and each Monday-to-Sunday week (at most 26) or calendar
  month (at most 12). Nothing is summed across windows. It reports engine-on, drive and idle hours,
  AVOIDABLE idle hours and cost (the page's headline), reducible idle, trucks judged and left out, and
  the day the figures reach through. `idling_summary` (raw `idle_events`, every idle minute priced)
  stays, and its description now points period and trend questions here. `assistantWeeksIn` and
  `assistantPreviousRange` joined `assistantPeriods.ts`. Five deliberate breaks, each killed.
  - **Found for the dispatch tools (next):** `/api/livemap/*` and the loads router also require the
    `dispatch` MODULE (`requireModule`), and `assistantContract.ts` models sections only. So a dispatch
    tool needs a module requirement in the contract. `assistantToolsFor` would take the org's modules,
    the way `canReachSurface` already does, resolved on the API through `org_module_enabled` and on the
    web through `useModulesQuery`. Gating on the section alone would answer for a carrier without
    Dispatch, which its page refuses. Fuel, safety, idle and accounting carry no module gate, so R1–R6a
    are unaffected.
- 2026-11-10 — **Q-AI10 fixed, server half.** One rule, `ledgerPeriod.ts` `lastIncludedDay` /
  `wholeMonthBound`: a window is half-open, and the month-grained reads widen from its last day. It is
  used by `readLedgerForPeriod`, `fleetReport.coveredMonths`, `getMileageCoverage`, the income
  statement's comparative, and the trend's coverage call (which now passes its own exclusive bound).
  The statement's previous-period read passes the bound (`periodFrom`), not the 1st of the last month.
  The finance tools send `exclusiveEndYmd(to)`, the web's own `exclusiveEnd`.
  - **Two merges, because the web and the API are separate Railway services** and land minutes
    apart. The server merges first: the old page still sends the last day and gets exactly today's
    figures (pinned by "still answers July alone when asked the old way, 07-01 to 07-31"). The four
    web hooks (`useFleetReport`, `useIncomeStatement`, `useMileageCoverage`, `useBillingActivity`) go
    back to `exclusiveEnd` in a second PR, merged only once the first is live in PRODUCTION. Shipped
    the other way round, a new page against an old API would widen July's `08-01` to July plus August
    for the deploy minutes.
  - Between the two, Ask AI's Trucks/contractor figures include the last day and the page's do not.
    That is the right direction, and it closes when the web half ships.
  - Six deliberate breaks, each killed by an assertion, never by a compile or reference error: web
    sends the last day, ledger widens from the bound, Samsara months from the bound, mileage months
    from the bound, the comparative's old inclusive read, and the tool sends the last day.
- 2026-11-10 — **R6b: the module gate and `fleet_now` (dispatch).**
  - **Contract:** a `ToolRequirement` is now a section level OR a module the carrier bought
    (`{ module }`), and `assistantToolsFor(role, sections, modules)` takes the carrier's `ModuleSet` the
    way `canReachSurface` does. The argument is REQUIRED, and `null` refuses every module-gated tool, so
    a forgotten argument cannot answer for a module nobody bought. A tool declares exactly its page
    route's gates. Today only `fleet_now` declares one (`dispatch`), because fuel, safety, roster,
    equipment and accounting routes carry no `requireModule`.
  - **API:** `POST /api/ai/ask` reads only `ASSISTANT_TOOL_MODULES` through `orgModuleSet`, the same
    cached `org_module_enabled` read `requireModule` makes, so the tool list and the page's route
    cannot disagree. A failed read withholds the module tools, logs it, and answers with the rest.
    **Web:** `useAssistantTools` / `useAssistantAccess` pass `useModulesQuery`'s set.
  - **`fleet_now`** (livemap): `readLiveMapBoardCached`, the Dispatch tab's own board and 5-second
    cache, counted by the board's `state` (`deriveVehicleState`, computed once on the board), never
    re-judged from speed. It gives moving, stopped, parked and offline counts, the same with a driver
    assigned ("how many drivers are moving"), in shop, never positioned, and an optional list (at most
    25: unit, driver, speed, location, load, next stop, position age) with the board's `as_of`.
  - **Tests and breaks:** contract (with and without Dispatch, `null`, section still decides), route
    (no Dispatch, Dispatch, failed read), tool (states that disagree with speeds), web hook. Six
    deliberate breaks killed: tool without its module, module check always true, route passes no
    modules, route throws on a failed read, counting by speed, and the web ignoring modules (that one
    first SURVIVED, so it got its own test).
  - **Next in R6b:** loads and miles per truck (`dispatch`, the same module gate), IFTA by state,
    maintenance cost per unit, card holds, DQ and inspection expiries, recruiting counts.
- 2026-11-10 — **R6b: `loads_by_truck` (dispatch), the Loads page's Delivered tab per truck.**
  `loads/assistantLoadsByTruck.ts` calls `listLoads` (`GET /api/dispatch/loads`) with the page's own
  delivery window: `dayRangeInstants` over the carrier's days, the end exclusive, exactly what
  `useDeliveredWindow` sends. It keeps the rows `loadBoardState` puts in the `delivered` queue and
  counts them per truck, so "748 delivered 14" is the Delivered tab with that truck picked. It never
  reads `loads` itself.
  - **Which miles:** McLeod's per-load `total_miles` (the projection's `move_distance`, the figure on
    the load page), summed per truck. These are dispatched miles. Measured miles stay `fuel_report`'s
    (Samsara odometer difference) and billed miles `finance_report`'s, and the answer says so. A load
    with no miles is counted (`loads_without_miles`), never added as 0. Empty moves (`loaded = false`,
    D-LA5) remain rows on the tab, so they stay in the count and are also counted on their own.
  - **Freshness:** `mcleod_synced_at` (the newest `external_synced_at`, the page's "as of") and
    `delivery_history_begins` (`loadsHistoryFrom`), with a `history_note` when the window starts
    before it, so a March question is never answered as a zero.
  - **Access:** `[bought("dispatch"), view("dispatch")]`, the loads router's own two gates.
    Named units: a unit of this fleet with no delivery is a real 0; a unit that isn't this fleet's is
    named back. Boundary edge `insights -> loads`; suggestions on `dispatch.loads`.
  - Nine deliberate breaks, each killed by an assertion: UTC instants, every non-canceled row counted,
    missing miles as 0, empty moves subtracted, the vehicles lookup unscoped, a stranger answered as
    0, no history note, sync time from the first row, and the contract without the module gate.
- 2026-11-10 — **R6b: `ifta_report` (fuel), the IFTA ledger by state.** `ifta/assistantIftaReport.ts`
  calls `readIftaPeriod` (`GET /api/ifta/period`: the 0256 RPCs plus McLeod's hand-keyed receipts) for
  the quarter asked and turns the rows into figures with `ledgerPosition`, the page's own shared join
  (the one the return export also calls, IP9). The miles tie-out is the page hook's `tieOutMiles` over
  the same three inputs. Per state, it gives taxable and total miles, gallons burned and bought (with
  receipts on their own), rate, tax owed, tax paid and net; plus the totals and the fleet MPG every
  liability rests on, with its verdict.
  - **Quarter:** last quarter by default, `this_quarter`, or an explicit year and quarter, on the
    carrier's clock. A quarter that has not started is refused without a read.
  - **Completeness, from the page's own footnote:** months pulled from Samsara (a month in progress is
    not served, #1333), any provisional month, vehicles Samsara reported that we could not map, the
    share of miles the tax table can price, and the states it cannot (never taxed at zero). Under
    three months there is an `incomplete_note`, and the tool description forbids calling the figures
    the return.
  - **Access:** `fuel: view`, the IFTA router's only gate (no module). Boundary edge
    `insights -> ifta`; suggestions on `fuel.ifta`.
  - Nine deliberate breaks, each killed by an assertion: UTC clock (a late-evening 30 September test
    was added after this break first SURVIVED), this quarter as the default, receipts dropped, net as
    liability, a future quarter allowed, no incomplete note, tie-out on the wrong gallons (it
    SURVIVED, so `implied_mpg` is now in the answer and pinned), states unfiltered, an unscoped
    timezone read.
- 2026-11-10 — **R6b: `maintenance_cost` (maintenance), repair bills per truck or trailer.**
  `fleetpal/assistantMaintenanceCost.ts` does what the truck page's repair-bills line does through
  `GET /api/maintenance/units/:kind/:id/maintenance`: `readCoverage` first, NO cost at all when
  `coverageIsPrintable` refuses (D-FP4, the route's 409, with the months that lack a ledger total), then
  `readUnitCost` per unit. The default window is the page's own (the last 12 full months, half-open);
  a named period is sent with an exclusive end, as the route takes it.
  - **FleetPal and McLeod are two named values (D-FP18).** Per unit: FleetPal's operational cost (labour
    included, the page's headline), its parts, labour, labour hours, services, fees and tax, repairs,
    days in the shop, miles and cost per mile. McLeod only per month and fleet-wide (`mcleod_by_month`:
    the GL maintenance family, FleetPal's invoicing, and the coverage share as "at least", D-FP15),
    because `mcleod_gl_totals` has no equipment dimension. There is no McLeod figure per unit, and the
    answer and the tool description both say so. Unmatched FleetPal units travel beside the figures
    (D-FP14).
  - Units are named (at most 10). A number a truck and a trailer share is both units, each read as its
    kind. Strangers are named back. A unit with no FleetPal mapping says `not_in_fleetpal`.
  - **Access:** `maintenance: view`, the route's only gate. The technician gets a first tool (named
    fact updated). Boundary edge `insights -> fleetpal`; suggestions on `maintenance.units`.
  - Ten deliberate breaks, each killed by an assertion: inclusive end, 30-day default, no D-FP4
    refusal, labour stripped from the cost, a McLeod field per unit, a trailer read as a truck (it
    SURVIVED, so the test now pins each unit's kind), first match only, unscoped trailers, invoicing
    over GL in place of the lower bound, and the whole fleet when no unit is named.
- 2026-11-10 — **R6b: `card_holds` (fuel), cards on hold or on a fraud hold now.** The Fuel cards
  list was an inline query in `efs/routes/read.ts`. Per D-AI2 it became `efs/services/efsCardList.ts`
  `listEfsCards`, with the route as its first caller (unchanged behaviour: the existing route tests
  pass untouched), so the tool reads the same mirror rows through the same `cardRowToSummary`, the one
  place a card is masked. The page's "checked" clock, `reachableSyncFloor` (absent cards never drag it),
  moved from the web's `cardControlModel.ts` to `@silvicom/shared`; the web re-exports it.
  - **The answer:** counts by status in the page's words (`EFS_CARD_STATUS_LABELS`, matched case-blind
    with `efsStatusEquals` because the account stores `HOLD`/`FRAUD`); each held card by truck, driver
    and `•••• last4`, fraud first; `cards_checked_at`. A card EFS no longer lists keeps its last status
    in the mirror (••7967 has read FRAUD since 09-23), so it is listed apart and never counted as held
    now. No full number exists in the summary, and the driver-id prompt is left out (D-AI7).
  - **Access:** `fuel: view`, the list route's gate. It reads only our database, so it does not need
    the EFS-whitelisted host. Boundary edge `insights -> efs`; suggestion on `fuel.cards`.
  - Eleven deliberate breaks, each killed by an assertion: `===` status match, absent cards counted,
    the clock over every card, raw vendor words, the driver-id prompt leaked, the status filter
    ignored, a failed read as an empty list, fraud not first, the list unscoped, `eq` in place of
    `ilike`, and the total from the rows (it SURVIVED until the fixture's count differed from its rows).
- 2026-11-10 — **R6b: DQ and inspection expirations, two tools, each gated by its own page.**
  - **`driver_file_expirations` (roster)** is `evidence/assistantDriverFiles.ts` over
    `getComplianceOverview`, the Drivers page's file read (`GET /api/compliance/overview`, the File
    and expiry columns since DQ-INTO-DRIVERS). It is asked with the route's own `today` and the
    default horizon, the module's founding invariant. It gives files complete, incomplete and not
    started; per item, how many drivers have it expired, expiring or missing; and each driver's items
    in the page's own rank (`compareAttention`: expired, missing, expiring). It never passes Med-Stop
    violations or papers: a return-to-duty item exists only because of a positive result, so D-AI7
    keeps it out for every role. That is what a reader without testing-record access sees on the page.
  - **`annual_inspections_due` (maintenance)** is `maintenance/assistantAnnualDue.ts` over
    `readAnnualDue`, the Shop worklist's annual group (`GET /api/maintenance/annual-due`, shared
    `inspectionExpiry`, 30-day window). Overdue and due soon are split by the reader's own
    `daysRemaining`, in its order. The answer always says what is NOT on the list: units with no
    recorded inspection, and FleetPal's own dates.
  - **The plan's premise was wrong, and the matrix decides:** the handoff called recruiting counts "the
    first tool a recruiter can reach". But the matrix gives the recruiter `roster: view` and the
    overview route gates on exactly that, so `driver_file_expirations` is the recruiter's first tool.
    The technician now has two (repair bills, annual due). The named facts and
    `namedGrantGates.test.ts` are updated; nothing is written as a role list.
  - **Found, not fixed (the DQ page's own rule):** `/api/compliance/overview` and `readAnnualDue` cut
    `today` as the UTC day (`new Date().toISOString().slice(0, 10)`). From about 6 pm Central, that is
    tomorrow, so an item flips to "expired" a few hours early (D-PREC6). Both tools keep the route's
    day so the answer equals the page. The fix belongs to those readers (carrier-zone `todayInZone`)
    and moves page and tool together. Recommend a small PR in the evidence/maintenance area.
  - Thirteen deliberate breaks, each killed by an assertion: carrier-zone day in place of the route's,
    testing records passed, a wider horizon, no worst-first sort, the state filter ignored, a named
    clean driver dropped, no partial-read note, complete miscounted; the annual reader's own clock,
    overdue including today, a failed read as empty, kind ignored, re-sorted by unit.
- 2026-11-10 — **R6b: `recruiting_counts` (recruitment), the Applicants board's queues. The R6b list is
  done.** The board's read was built inside `GET /api/recruitment/pipeline`'s handler. Per D-AI2 it
  became `readApplicantPipeline` (same file, same queries, order and rows), with the handler as its
  first caller: the 1,988 recruiting tests pass untouched, and a new `employmentPipeline.test.ts` pins
  the archived half and the failure path. `recruiting/assistantRecruiting.ts` counts the board's own
  fields over those rows: `checklist.waiting_on` (the "Waiting on you / them" options),
  `checklist.ready_to_screen`, `checklist.phase` in `HIRING_PHASE_LABELS`, and decisions by outcome.
  It lists applicants longest-waiting first, the board's default order (Q-HUI4).
  - **Statuses only (D-AI7):** name, stage, who it waits on, the next step's words, days waiting, steps
    done, a decision's OUTCOME. Never a decision's reason, which can rest on a consumer report (FCRA);
    never gap days or whether a date of birth is recorded. Archived applicants are left out, as on the
    board's first view.
  - **Access:** `recruitment: view`. With the matrix as shipped, the recruiter now has two tools
    (driver files, applicants); named facts and `namedGrantGates.test.ts` are updated. The phase enum
    is read from `HIRING_PHASE_LABELS`, not restated. Boundary edge `insights -> recruiting`;
    suggestions on `recruitment.applicants`.
  - Nine deliberate breaks, each killed by an assertion: archived included, the reason leaked, ready
    taken from the stage, the waiting filter ignored, oldest last, a failed read as empty, raw phase
    keys; and in the extracted reader, a failure swallowed and `archived` ignored (both SURVIVED the
    route tests, so the reader got its own test file).
  - **Next:** R3a (follow-up questions), R4 (CSV/PDF and "open in page"), R7 (eval set).
- 2026-11-10 — **R3a server half: follow-up questions.** `POST /api/ai/ask` takes an optional `history`
  (each earlier turn's question and answer TEXT) beside the question. `@silvicom/shared`
  `assistantAskContract.ts` `assistantHistoryForRequest` is the one trim, for the web and the API alike.
  It keeps well-formed turns only, the newest 6, then drops the oldest until the answers fit 12,000
  characters (about four 25-row tables; at Haiku 5.5 prices about $0.0004 a round). An over-long answer
  is cut to 4,000, not dropped. `askData` replays the turns as alternating user/assistant text ahead of
  the new question.
  - **No tool results are replayed.** The system prompt tells the model to carry the subject over but
    call a tool again for every figure it states, so "and the month before?" re-reads rather than
    quoting an hour-old number. History is browser-written and untrusted like the question: access
    still comes only from `assistantToolsFor`, the per-call check and D-AI7's strip. The `ai.ask` audit
    row records `history_turns`. No migration (R3b, persisted conversations, still waits on Q-AI4).
  - **Two merges, as Q-AI10:** an older web sends `{ question }` alone and is answered exactly as
    before (pinned). The web half (the store sends its done turns through the same trim, and the
    composer's "each question is answered on its own" line goes) ships only once this is in
    PRODUCTION. A new web against an old API would answer "and last month?" with no subject for the
    deploy minutes.
  - Nine deliberate breaks, each killed by an assertion: history dropped, question before history, no
    re-read instruction, the route ignoring history, the route untrimmed, the audit without the count,
    the oldest kept, no character budget, an over-long answer dropped.
- 2026-11-10 — **R4a: "Open in …" links and CSV for each answer table.** `assistantContract.ts`
  `ASSISTANT_TOOL_PAGE` names the page each tool's figure IS (D-AI3's `source.surfaceKey`), and only
  for the tools built on a page's own read (R1, R6a, R6b). The older tools that sum raw tables get
  `null`: a link would claim their number is that page's. It is pinned by "every page a tool names is a
  real surface, gated by one of the tool's own sections". `POST /api/ai/ask` now answers
  `{ answer, pages }` (`assistantAnswerPages`: each successful tool's page, once, in call order). The
  field is additive, so an older web ignores it and the new web tolerates its absence. One merge.
  - **Web:** under an answer, "Open in Fleet report →" links from that structured list, never parsed
    from the model's text (D-AI8). A link is drawn only when the person can open the page
    (`useAnswerPages`: `canReachSurface` then `surfaceAllowed`, the sidebar's own two questions), which
    is how Q-AI12 surfaced. Each answer table has "Download CSV" (`tableCsv` + `downloadCsv`: the words
    on screen; in a numeric column `$` and thousands separators are dropped so it sums; `csvCell`'s
    formula guard).
  - **Not built (R4b):** PDF, and "open in page" WITH the answer's filters (units, period). Both need
    D-AI6's page filter contracts in `packages/shared` (Step 5), page by page, starting with Fuel costs
    and the Fleet report. Recommend R4b as the first D-AI6 slice: `fuelSpendFilterContract` read by
    `/fuel-spend`'s `useQueryState` and by `fuel_report`. The page's own export then serves as the
    PDF/CSV of the full figure.
  - Ten deliberate breaks, each killed by an assertion: a failed tool linked, duplicates kept, a wrong
    page, a legacy tool linked, the route sending no pages, no reach check, no screen-grant check,
    dollars kept in a numeric column, a text column stripped (it SURVIVED until a money-looking text
    cell was in the fixture), pages dropped by the store.
- 2026-11-10 — **R7 built: the eval set (Step 1c), run on demand, never in CI.**
  `insights/eval/assistantEvalSet.ts` has 23 cases:
  - **real (11):** every distinct question in production's `ai.ask` rows, 07/02 to 11/10 (21 asks, 11
    distinct), copied exactly, typos included;
  - **tool (10):** one per R6 tool, worded as its page's suggestion, plus an R3a follow-up;
  - **role (2):** a recruiter asking fuel, a dispatcher asking profit; both must be refused in words.
  - **What is judged:** only what the model decides: the tool ("any of"), its input (units compared as
    units), the ending, and words the answer must say. Figures are not re-checked: each tool equals
    its page by construction and by its own spied test. `scoreCase` is pure.
  - **How it runs:** `runAssistantEval` asks through `askData` itself, the endpoint's loop, with
    `assistantToolsFor(case.role, …)`. It writes nothing: no usage row, no audit row, no carrier budget
    (as `ads:eval`). Run it with `pnpm --filter @silvicom/api eval:assistant --org <uuid> [--only …]
    [--record]`. `--record` writes `eval/baseline.json`.
  - **Cost and data:** about $0.05 for the set at Haiku 5.5 list price, on the developer's key. It
    READS the named carrier's data with the `.env`'s service role (`apps/api/.env` is production) and
    sends it to the model provider exactly as Ask AI does. `--org` is required for that reason.
  - **Honesty is pinned:** every expected tool exists and is one the case's role is actually given;
    ids and real questions are unique; each refusal case's role has no tool that could answer it;
    every reporting-track tool is asked at least once.
  - Eight deliberate breaks, each killed by an assertion: outcome ignored, an errored call counted
    (it SURVIVED until a failed call was tested alone), units compared raw, a refusal ignoring calls,
    mentions skipped, the runner giving every tool, the runner dropping history, a case its role
    cannot reach.
  - **Not yet run.** The first baseline needs the owner's go: it reads production and spends about
    $0.05. After it, `idling_summary` can be retired if no case needs it (R6b's open item).
- 2026-11-11 — **Owner approved every recommendation in `HANDOFF-2026-11-11-R4B.md`** and ordered the
  build, one PR each: (1) Q-AI12, Fuel costs to fuel view; (2) one carrier-day `orgToday` at every
  UTC-day read (DQ, annual inspections, digest, alerts); (3) Q-AI4, 13-month retention for
  `ai_assistant_usage`; (4) R4b deep links carrying the answer's filters, page by page (Fuel costs,
  IFTA, Loads, Applicants/Drivers/Fuel cards, then the Fleet report's period into its URL and its link);
  (5) the held R3a web half (`claude/askai-follow-ups-web`) once #2223 is in production, checked before
  every PR; (6) the first eval baseline on production after 1–4, only after a one-line go from the
  owner right before it runs. Rulings recorded under Q-AI4 and Q-AI12 in §5.
- 2026-11-11 — **Q-AI12 built: Fuel costs and Buy discipline open to `section("fuel")` (view).**
  - `surfaceCatalogue.ts`: `fuel.spend` and `fuel.spend.buy-discipline` move from `manage("fuel")` to
    `section("fuel")`. Buy discipline was checked first: four read RPCs (`fuel_buy_fills`,
    `fuel_policy_gallons`, `fuel_contract_totals`, `fuel_spend_lines`, all security invoker) and the
    fuel policy read; its page issues no write.
  - Who it changes, by default: every `fuel: "view"` role — accountant, auditor, dispatcher and
    safety_manager — now sees Fuel costs in the sidebar (13 nav snapshots, each that one line added,
    recorded in `navEquivalence.test.ts`), and Ask AI's "Open in Fuel costs" link draws for them.
  - Tests that pinned the old gate were rewritten to the ruling: `sectionGuard.test.ts` (auditor now
    opens both pages, recruiter still refused), `useAnswerPages.test.ts` (accountant gets the link; a
    recruiter does not), and `nav.test.ts`'s view/manage case, which now uses Fuel planning
    (`manage("dispatch")`) because fuel has no `manage` screen left — killed by its assertion when
    Fuel planning was mutated to `view`.
  - Pinned by `assistantContract.test.ts` "asks no more than the tool: a page's section level is one the
    tool's own requirement on it grants". Deliberate break: the page back at `manage("fuel")`, killed
    by its assertion (`fuel_report -> fuel.spend: expected 'view' to be 'manage'`). No test pinned the
    old gate before, which is how the two halves drifted.
- 2026-11-11 — **Carrier-day fix built: one `orgToday`, at every UTC-day read the handoff found.**
  - **One definition:** `org/orgToday.ts` `orgToday(admin, orgId, now?)`, exported from org's index
    (org owns `organizations`). `inspections/read/orgToday.ts` is deleted (its two routes import org's),
    and recruiting's `carrierToday` is now a re-export of it under the old name, so its thirty-odd
    callers did not move.
  - **Moved to the carrier's day:** the Drivers page's overview (`GET /api/compliance/overview`), the
    driver pass of the DQ alert run, the binder's default "as at", the Monday digest's DQ section, the
    Shop's annual-due and FleetPal-disagreements readers, the inspectors list's "qualified today", and
    the dispatch board — its annual chip and its drivers' credential warnings, which now share the day
    the board's rows were cut on. Both assistant tools follow their pages: `driver_file_expirations`
    calls `orgToday` with its own `now`, and `annual_inspections_due` gets it through `readAnnualDue`.
  - **The two written dates, read first as the handoff asked:** a correction's `inspected_on` (append-only
    `vehicle_inspections`) is a day on the shop's own calendar, the same kind the inspector types on a
    new report, so it moved — a correction started at 7 pm Central was filed as inspected tomorrow. The
    inspectors list's day is a read (`isQualifiedOn`), never written. `listInspectors` lost its UTC
    default; its one caller passes the day.
  - The DQ alert dedupe keys are the expiry date and threshold, not today, so the move re-sends nothing.
  - **Not moved:** medstop's own `orgClock` (already the carrier's day, injected), and `askData`'s fleet
    MPG window (a fuel read, not in the handoff's list).
  - **Tests, at 01:30 UTC on 11/11 (7:30 pm Central on 11/10):** `orgToday.test.ts`; `annualCarrierDay.test.ts`
    (an annual good through 11/10 is due, not overdue; a one-day disagreement is shown, not lost);
    `dqAlertScheduler.test.ts` "does not call a CDL good through 11/10 expired at 7:30 pm Central on 11/10,
    when UTC is already 11/11" (its fixture's "today" is now the carrier's day too — the UTC one would
    have failed every Central evening); `assistantDriverFiles.test.ts` now asks for 11/10 and is
    org-scoped. A source check keeps the UTC cut out of the eleven sites.
  - Deliberate breaks, each killed by an assertion: the DQ run, `readAnnualDue`,
    `readAnnualDisagreements`, the driver-files tool and `orgToday` itself put back on the UTC cut, and the
    correction's `inspected_on` (caught by the source check).
