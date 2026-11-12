# F21 plan — the Silvicom assistant (Ask AI rebuilt)

**Status:** PROPOSED 2026-10-08; Q-AI1..Q-AI9 all ruled 2026-11-11 (§5). R1–R7 and R4b are built (§6).
Findings are in `AUDIT.md` (IDs U, N, W, S, A, D, P, C).

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
  - **Ruled 2026-11-11 (owner, one pass):** (a) Haiku 5.5 ("good for this"). The cap is unchanged:
    $50 per org per month and the admin alert at 80%, as built in R2b
    (`ASSISTANT_MONTHLY_CAP_MICRO_USD`, `ASSISTANT_CAP_ALERT_SHARE`). Sonnet only on evidence from
    the eval, as (c) says.
- **Q-AI2. Which roles start ON** (`startsOnFor`; admin always on). Recommend fleet_manager,
  dispatcher, safety_manager, accountant. Recruiter and technician once their sections have tools
  (Step 4). Auditor off. Driver never.
  - **Ruled 2026-11-11 (owner, one pass):** as recommended: fleet_manager, dispatcher, safety_manager
    and accountant start ON; recruiter and technician later; auditor off; driver never. **Not yet
    switched:** `surfaceCatalogue.ts` still has `startsOnFor: []` (admin only), and switching it puts
    Ask AI in front of four roles on the next release. Q-AI8 puts the live test at "100% complete",
    so the switch waits for the owner to say when (recommend: at that live test).
- **Q-AI3. Voice engine.** (a) Browser speech recognition: free and instant, but audio goes to
  Google (Chrome/Edge) or Apple (Safari), Firefox is off by default, and there is no custom vocabulary;
  (b) server speech-to-text (Deepgram or AssemblyAI, ~$0.003–0.008/min): every browser, keyterms for
  unit numbers, but a new vendor and DPA. **Recommend (a) first, with Chrome's on-device mode where
  available, and (b) only if unit numbers are misheard in the task walk.**
  - **Ruled 2026-11-11 (owner, one pass):** no voice for now. Step 3c is not built; (a) stays the
    recommendation if it is ever asked for.
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
  - **Ruled 2026-11-11 (owner, one pass):** confirmed, and it applies to the admin too (as built).
- **Q-AI6. First write actions.** Candidates: assign a finding, close/dismiss with reason, message
  a driver, add a card override, create a saved view. Recommend assign + saved view first
  (reversible, low stakes); card overrides last.
  - **Ruled 2026-11-11 (owner, one pass):** **no write actions.** Ask AI reports, in the chat, and
    the report can be downloaded; it changes nothing on the rest of the product or in the database.
    Step 6 is dropped. Download today: every answer table has "Download CSV" (R4a), and "Open in …"
    opens the page whose own exports (the statement PDF) print the same figure.
- **Q-AI7. The dock.** Accept a non-modal docked panel as a new pattern in
  `DESIGN-SYSTEM-CONTRACT.md` §6? Recommend yes. A SlideOver's scrim blocks the page the assistant
  filters.
  - **Ruled 2026-11-11 (owner, one pass):** yes. Step 3a (the non-modal dock, its design-contract
    entry) is the next build.
- **Q-AI8. Named first users.** One person per role for the Step 3/4 task walks (Q-PR3). Q-PR2 hid
  Ask AI until it has one.
  - **Ruled 2026-11-11 (owner, one pass):** no named per-role first users now. The owner tests it
    live once the feature is 100% complete and production-ready, so the Step 3/4 task walks become
    that one live test, and every remaining step must arrive finished, not as a draft for a walk.
- **Q-AI9. Data handling.** Questions and tool results go to Anthropic (commercial API terms; no
  training on API data). Does any carrier contract require zero data retention or US-only inference
  (`inference_geo: "us"`, +10% cost)? Recommend standard global unless a contract says otherwise.

  - **Ruled 2026-11-11 (owner, one pass):** standard (global) processing. The owner: every figure in
    an answer is pulled from the collectors (the carrier's own operating data: telematics, fuel
    cards, TMS), and no carrier contract requires zero data retention or US-only inference.
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

- **Q-AI13. The Drivers roster cannot show "drivers with an item expiring" (found at R4b (d),
  2026-11-11).** `driver_file_expirations` filters by ITEM state (expired, expiring, missing); the
  roster's File filter is the driver's WORST chip (`fileChip`: expired, then missing, date only, not
  dated, then expiring). They agree only for `expired`. A driver with one item expiring and one missing
  is chip "missing", so `file=expiring` would leave out a driver the answer listed. R4b therefore
  links the roster with filters only for `expired`; every other answer opens the roster as R4a did.
  Candidates: (a) leave it — the answer lists the drivers, the roster shows them under "Needs
  attention"; (b) a roster filter by item state (`?item=expiring`: any requirement in that state),
  read through `driversLinkContract.ts`, which the tool's link then uses; (c) send `file=attention`, a
  superset, and say so under the link. **Recommend (b)** when an office asks for it: it is the honest
  page capability, and (c) shows a different list from the answer. Until then, (a).

- **Q-AI14. Fuel problems has no dollar-amount filter (found at Step 5, 2026-11-12).** Step 5's acceptance
  question is "show me open findings over $200 for unit 718". The page filters by state, kind, truck,
  days and owner, but not by amount. So Ask AI opens nothing and says the page can't filter by amount
  (the contract refuses the key, as the acceptance requires). Options:
  - (a) Add a "minimum amount" filter to Fuel problems: one URL key read through
    `fuelProblemsLinkContract.ts`, and a server-side bound on the queue read, so the export honours it too.
    It is a page PR of its own, about a day.
  - (b) Leave it, and Ask AI keeps saying so.

  **Recommend (a):** an office sorting a queue by "is this worth chasing" needs it with or without
  Ask AI.


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
- 2026-11-11 — **Q-AI4 (a) built: `ai_assistant_usage` is pruned after 400 days.**
  - A rule in `org/dataRetentionPolicy.ts` (`asked_at`, id strategy, org-scoped), run by the daily
    `data_retention` job like every other. `scripts/table-modules.json` records `retention_days: 400`.
  - **Why 400 and not 365:** "13 months" is a year-over-year view, which needs last year's SAME month
    whole; on the 31st that month began 396 days back. 400 is also the repo's existing "rolling ~13
    months" for raw telematics.
  - **Nothing the budget reads is pruned:** the month meter sums only the current month (`p_since`),
    and `org_usage_month` keeps its own rolled-up totals.
  - (b) and (c) need no code: the `ai.ask` audit row stays in `audit_logs` (`RETENTION_FORBIDDEN`), and
    conversations stay tab-local.
  - Pinned by `dataRetention.test.ts` "prunes Ask AI's cost rows after 13 months, keeping last year's
    same month whole, and never the audit row of the question". Deliberate break: `keepDays: 365`,
    killed by its assertion.
- 2026-11-10 — **R3a web half built, PR held until #2223 is in PRODUCTION** (branch
  `claude/askai-follow-ups-web`). The store sends each question with the thread's earlier ANSWERED
  turns through `assistantHistoryForRequest`, the API's own trim. A failed or pending turn is never
  sent; a retry carries only what came before it; "New chat" starts with none. The composer's line
  says follow-ups keep the subject. `QUESTION_MAX` now reads the contract's
  `ASSISTANT_QUESTION_MAX`. Three deliberate breaks (history not sent, failed turns sent, later turns
  on retry), each killed by an assertion.
- 2026-11-11 — **R3a web half opened and merged.** Checked first, as the handoff required: #2223's
  merge commit `038950f` is an ancestor of `origin/production`, and `pnpm verify:live` showed the
  production API serving `e39dcd7` (release #2222). `origin/main` was merged in. The store keeps R4a's
  `pages` beside R3a's `history`, and the store's note now says Q-AI4 is ruled (tab-local).

- 2026-11-11 — **R4b (a) built: "Open in Fuel costs" opens the answer's own days and trucks.**
  - **One link builder, read by the page and the tool (D-AI6):** `packages/shared/src/fuelCostsLinkContract.ts`
    has the page's six URL keys (`FUEL_COSTS_QUERY_KEYS`) and `fuelCostsToQuery`. `useSpendFilters`
    and `useFuelCostFilters` read their keys from it. `fuel_report` returns
    `link: { surfaceKey, query }` built by `fuelCostsToQuery` from the days and vehicle ids it read.
  - **The link never reaches the model (D-AI8):** `splitAssistantLink` (shared) lifts `link` off a
    tool's result in `askData` before `stripNeverExposed` and before the result is sent back. It keeps
    the link only when it points at the tool's OWN page (`ASSISTANT_TOOL_PAGE`) and every value is a
    string. `AskTrace.links` carries them; the audit row does not.
  - **Response, additive:** `{ answer, pages, links }`. The store keeps `links`, and `useAnswerPages`
    gives each page `to: { path, query }` when a link for it exists (the LAST one, since the model's
    final call is the one its answer reports), else the bare path. An older web ignores `links`; an
    older API sends none, and the links stay R4a's. Same reach check as before.
  - **PDF:** the page's own button prints the figure the link opens; no assistant renderer.
  - Tests: `fuelCostsLinkContract.test.ts`; `assistantContract.test.ts` "splitAssistantLink — the link
    comes off before the model sees the result (F21 R4b, D-AI8)"; `assistantFuelReport.test.ts` "links
    to Fuel costs with the answer's own days and the named trucks by vehicle id, built by the page's
    contract" (last quarter → 07/01–09/30 inclusive, units → ids, fleet → no `trucks`); `askData.test.ts`
    "lifts each tool's page link off its result before the model sees it, and returns the links in call
    order (R4b)" (no id anywhere in what the model was sent) and a link to another page dropped;
    `ai.test.ts` (response carries `links`, the audit row no id); `FuelCostsPage.test.ts` "opens on
    exactly the filters a link built by its contract carries"; `useAnswerPages.test.ts` and
    `assistant.test.ts`.
  - Deliberate breaks, each killed by an assertion: the page reading a literal key, the link carrying
    unit numbers, `askData` leaving the link in the model's result, the first link kept instead of
    the last, and `splitAssistantLink` skipping its own-page check.
  - Next: (b) IFTA `q=`.
- 2026-11-11 — **R4b (b) built: "Open in IFTA" opens the answer's quarter.**
  - `packages/shared/src/iftaLinkContract.ts`: the ledger's one URL fact, `q=YYYY-Qn`
    (`IFTA_QUERY_KEYS`, `iftaQuarterKey`, `parseIftaQuarterKey`, `iftaToQuery`). The web's
    `quarterKey` / `parseQuarterKey` are now these functions under their old names, and both IFTA
    pages read the key from the contract; the ledger's per-state links use `iftaToQuery`.
  - `ifta_report` returns `link: { surfaceKey: "fuel.ifta", query: iftaToQuery(quarter) }`, lifted
    off before the model sees it by (a)'s `splitAssistantLink`. The page's return export then prints
    that quarter.
  - Why it needed a contract: the ledger falls back to its NEWEST quarter on any `q` it cannot parse,
    without a word, so a hand-built `q=Q3 2026` (its own label) or `q=3` would show Q4's tax beside
    an answer about Q3.
  - Tests: `iftaLinkContract.test.ts`; `assistantIftaReport.test.ts` "links to the ledger on the asked
    quarter in the page's own URL form, built by its contract" (including 12/31 late in Chicago, already
    January in UTC, still Q4); `IftaLedgerPage.test.ts` "opens on the quarter a link built by the
    contract names, and links each state on the same quarter".
  - Deliberate breaks, each killed by an assertion: the ledger reading a literal key, the tool linking
    with the quarter's label, and the parser accepting a fifth quarter.
  - Next: (c) Loads.
- 2026-11-11 — **R4b (c) built: "Open in Loads" opens the answer's deliveries.**
  - `packages/shared/src/loadsLinkContract.ts`: `LOADS_QUERY_KEYS` (`queue`, `delivered_from`,
    `delivered_to`, `truck`, `driver`, `scope`) and `loadsToQuery`. `useDeliveredWindow`, the Loads
    page's tab/Driver/Truck params and `useScopeChoice` (shared with the dispatch board) read their keys
    from it.
  - `loads_by_truck` links to the Delivered tab, its inclusive carrier days, `scope=all`, and `truck`
    by vehicle id when exactly ONE unit was named. The page's Truck filter takes one id, so several
    named trucks (or the whole fleet) leave it out, and the page lists every truck the answer counted.
  - Three traps the contract closes: the window is inclusive DAYS on the page but instants with an
    exclusive end in the API (`delivered_before`); `truck` is an id, not a unit; and a dispatcher linked
    to fleets opens on "mine" by default, which would show fewer loads than the answer — the tool counts
    every dispatcher's, so the link says `scope=all`.
  - Tests: `loadsLinkContract.test.ts`; `assistantLoadsByTruck.test.ts` "links to the Delivered tab on
    the answer's inclusive days, the whole fleet's scope, and one named truck by vehicle id";
    `DispatchLoadsPage.test.ts` "opens on exactly what a link built by its contract names: Delivered, the
    days, every dispatcher's loads, one truck" and "opens a linked dispatcher on every load when a link
    built by the contract says scope=all (F21 R4b)".
  - Deliberate breaks, each killed by an assertion: the page's Truck param and the scope param read as
    literals, the link without `scope`, and a truck linked when two were named.
  - Next: (d) Applicants, Drivers, Fuel cards.
- 2026-11-11 — **R4b (d) built: "Open in" Applicants, Drivers and Fuel cards carry the answer's filters.**
  One PR for the handoff's one bullet, with three contracts, each read by its page:
  - **Applicants** (`applicantsLinkContract.ts`): `waiting`, `phase`. The board opens on "waiting on you",
    so an answer about everybody is linked as `waiting=any`.
  - **Drivers** (`driversLinkContract.ts`): `file`, `status`. Linked with filters only for `expired`
    (`file=expired&status=any`: the overview holds active and on-leave drivers, and the roster opens on
    active). Every other state links to the roster itself — Q-AI13 above.
  - **Fuel cards** (`fuelCardsLinkContract.ts`): `status`, one catalogue status. Linked only when the
    answer was about Hold or Fraud alone; "both" is not one parameter, so it opens the page itself.
  - **`LINK_ANY` is a labelled restatement** of `@silvicom/ui`'s `ANY_PARAM` (`linkContract.ts`):
    `packages/ui` takes no workspace dependency, so it cannot import shared. Pinned equal by
    `RecruitmentPage.test.ts` "the link contracts' any is the query state's ANY_PARAM"; removed when
    `ANY_PARAM` moves to a package both can import.
  - Tests: `listLinkContracts.test.ts`; one link test in each tool's suite; `RecruitmentPage.test.ts`
    "opens on everybody when a link built by its contract says so, and on a queue and stage when it
    names them"; `useRosterFilters.test.ts` "reads a link built by the Drivers contract: expired files,
    every status"; `fuelCardsFiltersInUrl.test.ts` "sends the status a link built by its contract names
    to the route".
  - Deliberate breaks, each killed by an assertion: everybody written as an empty `waiting`, each of
    the three pages reading a literal key, the Drivers link drawn for `expiring`, and the Fuel cards
    link drawn for both statuses.
  - Next: (e) the Fleet report's period into its URL, then its link.

- 2026-11-11 — **R4b (e) part 1 built: the Fleet report's period is in its URL.**
  - `packages/shared/src/fleetReportLinkContract.ts`: `?from=YYYY-MM&to=YYYY-MM&grain=…`, inclusive
    months (`FLEET_REPORT_QUERY_KEYS`, `FLEET_REPORT_GRAINS`, `fleetReportToQuery`). The web's
    `PeriodGrain` is the contract's `FleetReportGrain`.
  - `grain` is in the URL because months alone are ambiguous: January–March is Q1 and the year to
    March, which step differently. `periodFromLink` (web `reportPeriod.ts`) keeps a grain only when that
    grain's own period covers exactly the linked months, else reads a custom range of whole months, so
    the URL and the rail cannot disagree.
  - The page: a linked period wins over the opening month (and its "opens on" note); with none, the page
    opens as before and writes nothing until the rail moves, so a plain visit keeps a clean URL. The
    rail's choice is written by the contract's writer, and the URL moves the rail back (Back/Forward,
    another answer's link).
  - Worth having for the page alone: a month of the Fleet report could not be sent to anybody before.
  - Tests: `reportPeriod.test.ts` "periodFromLink — the period a Fleet report link names (F21 R4b (e))"
    (grain kept, custom, not a month, every grain round-trips the writer); `FleetReportPage.test.ts`
    "opens on the period a link built by its contract names, without the latest-month note" and "writes
    the rail's choice into the URL, and a plain visit writes nothing".
  - Deliberate breaks, each killed by an assertion: the page ignoring the link, not writing the rail's
    choice, not following the URL, `periodFromLink` trusting the grain unchecked, and the writer
    dropping the grain.
  - Next: (e) part 2, the Fleet report link from `finance_report` and `income_statement`.
- 2026-11-11 — **R4b (e) part 2 built: "Open in Fleet report" opens the answer's months and tab.**
  - The Fleet report contract gains `tab` (`FLEET_REPORT_TABS`, the page's six, `overview` left out of a
    link; the page's `TABS` are typed by it and its tab param reads the key) and `fleetReportGrainOf`:
    one month is `month`, a calendar quarter `quarter`, January onward `ytd`, else `custom`; January to
    March is a quarter unless the question was about the year.
  - `finance_report` links its whole months — INCLUSIVE, as the rail states them; the API's exclusive
    end (Q-AI10) stays `exclusiveEndYmd`'s — on the tab that shows what was asked (`by=truck` →
    Per truck, `by=contractor` → Contractors, else the overview). `income_statement` links the same
    months on the Income statement tab. Both name `finance.fleet-report`; the web keeps the last.
  - PDF: the page's own statement export prints the figure the link opens.
  - Tests: `fleetReportLinkContract.test.ts`; `assistantFinanceReport.test.ts` "finance_report links the
    answer's inclusive months, their grain and the tab that shows what was asked" and "income_statement
    links the same months on the Income statement tab"; `FleetReportPage.test.ts` "opens on the tab a
    link built by its contract names, and its tabs are the contract's".
  - Deliberate breaks, each killed by an assertion: the link carrying the exclusive end, `by=truck`
    linked to the overview, any three months called a quarter, and the page's tab read as a literal.
  - **R4b's approved list is complete** (Fuel costs, IFTA, Loads, Applicants, Drivers, Fuel cards, Fleet
    report), apart from Q-AI13's Drivers states. Four tools with a page were not on that list and still
    link to it bare, as in R4a: `idle_report` (/idling), `fleet_now` (Dashboard), `annual_inspections_due`
    and `maintenance_cost`. Whether their pages can hold the answer's filters in the URL is not yet
    checked; that is the next slice if wanted.
- 2026-11-11 — **What is left after R4b, with recommendations** (owner asked for the list; recorded here
  so it is found with the plan, not in a chat):
  1. **First eval baseline on production** (R7): `pnpm --filter @silvicom/api eval:assistant --org
     86d6b3ea-4361-4f71-877f-e8373615769b --record`, ~$0.05, reads production and sends it to the model
     provider, writes nothing. Needs the owner's one-line go right before it runs. Then retire
     `idling_summary` if no case needs it. **Recommend: next.**
  2. **Q-AI13** (Drivers per-item states): **recommend (b)**, a roster item-state filter, when an
     office asks; until then the bare link.
  3. **The four page tools still linked bare** (`idle_report`, `fleet_now`, `annual_inspections_due`,
     `maintenance_cost`): check each page's URL state; give a link contract only where the page can
     show exactly the answer. **Recommend: after the baseline, one PR per page, as R4b.**
  4. **Streaming (Step 2d)**: nothing streams today. **Recommend: measure first** — the answer time
     per round is in `ai_assistant_usage`; build SSE only if the median answer is over ~5 s.
  5. **The dock (Q-AI7, Step 3a)**: launcher, thread and `/ask` exist; the non-modal dock, its
     design-contract entry, a11y states and a stubbed browser spec do not. **Recommend: rule Q-AI7 yes,
     then build it.**
  6. **R3b saved conversations**: stays unbuilt (Q-AI4 (c)).
  7. **Voice (Q-AI3, Step 3c)**: **recommend (a)** browser speech, hidden where unsupported, after the dock.
  8. **Breadth (Step 4)**: hazmat has no tool; dispatch assignments/HOS, safety scores, findings,
     parts and invoices are partial. Needs Q-AI8's named first users. **Recommend: one section per PR,
     each with eval cases, after the baseline shows where answers fail.**
  9. **Navigate (Step 5)**: `open_view` + current-page context, on the R4b contracts, plus contracts
     for Findings, Fuel log, Alerts and Vehicles. **Recommend: after the dock.**
  10. **Writes (Step 6, Q-AI6)**: **recommend assign a finding + create a saved view first**, each one
      existing endpoint, the user's own 403.
  11. **Unmarked rulings**: Q-AI1, Q-AI2, Q-AI3, Q-AI5, Q-AI6, Q-AI7, Q-AI8, Q-AI9 have no "Ruled" line,
      though Q-AI1/Q-AI2/Q-AI5 already behave as recommended in code. **Recommend: the owner rules them
      in one pass, and the next PR records each.**
- 2026-11-11 — **R7: the first eval baseline, on production — 20 of 23.** Run on the owner's go with
  `eval:assistant --org 86d6b3ea-… --record` from main at `fb70993`, `claude-haiku-5-5`, $0.0238 for
  the set (the plan's ~$0.05 was double). It read Silvicom's production data with the service role and
  wrote nothing. Recorded in `apps/api/src/modules/insights/eval/baseline.json`; the next run after a
  prompt, tool-description or model change is compared with it.
  - **Passed (20):** every R6b tool case (loads, repairs, card holds, DQ files, annual due, applicants,
    income statement, idle vs before), both role refusals, the follow-up, and 9 of the 12 real
    questions, including "cost per mile", "how many drivers is moving at moment" and the nine units' MPG.
  - **Failed (3), all the same way — the model answered without calling a tool:**
    `flagged-fills-drivers` ("Which drivers had the most flagged fills this month?", expected
    `top_risk`), `top-stations` ("Top 5 fuel stations by spend in the last 30 days.", expected
    `fuel_ranking`), `ifta-by-state` (the accountant's "IFTA by state last quarter", expected
    `ifta_report`). An answer with no tool has no figures behind it, so each is either a refusal, a
    clarifying question, or a number the model made up — the eval does not record the answer text, so
    which one is not known.
  - **Recommend:** the next eval PR records each answer's text in the verdict (it is in the trace
    already, and the baseline is a local file), and re-runs only these three (`--only`, ~$0.002). Only
    then change a tool description or the prompt: guessing the cause from "called nothing" would fix
    the wrong thing as often as the right one.
  - **`idling_summary` stays.** The handoff said to retire it if no case needs it; one does.
    `worst-idlers-month` ("who are the worst idlers?") passed by calling it, and `idle_report` cannot
    answer that question: its `by` is `total | week | month`, with no driver or vehicle ranking. It is
    retired only when `idle_report` (the page's avoidable-idle verdict) ranks trucks and drivers.
- 2026-11-11 — **Q-AI1..Q-AI9 ruled in one pass; what is left, revised.** The rulings are under each
  question in §5. Their effect on "What is left after R4b" above:
  - **Dropped:** Step 6, the write actions (Q-AI6: Ask AI reports and downloads, and changes nothing);
    Step 3c, voice (Q-AI3); the per-role task walks (Q-AI8: one live test by the owner once the
    feature is complete). R3b saved conversations stays unbuilt (Q-AI4 (c)).
  - **Left, in order:**
    1. The three baseline failures, read before tuned: `eval:assistant --only flagged-fills-drivers,top-stations,ifta-by-state --answers`
       (needs the owner's go; ~$0.002), then the fix that the answers point to.
    2. R4b links for the four tools still linked bare, one PR per page where the page can show exactly
       the answer.
    3. Answer time measured from `ai_assistant_usage`; streaming (Step 2d) only if the median is over ~5 s.
    4. The dock (Step 3a, Q-AI7 yes), then `open_view` navigation (Step 5) on the R4b contracts.
    5. Breadth (Step 4), one section per PR with eval cases, guided by the baseline.
    6. Q-AI2's switch (four roles start ON): a one-line `startsOnFor` change, made when the owner says
       the feature is ready for the live test (Q-AI8), not before.
  - **Asked, not ruled:** whether "download the report" means more than the CSV per table, e.g. a PDF
    of the answer itself (not built; nothing in the plan proposes it yet).
- 2026-11-11 — **The baseline's three failures, read and measured: effort `low` refuses tools it has.**
  With `--answers` (#2261), on the owner's go, production data, nothing written:
  - **What the failures were:** all three were honest refusals ("none of my tools break down … by
    station / by jurisdiction / flagged fills by driver"), each offering what it could answer instead.
    No made-up figures. Yet `top_risk`, `fuel_ranking` and `ifta_report` were in the request (checked:
    25 tools for the admin, 17 for the accountant), their descriptions name the questions, and nothing
    narrows the list.
  - **Experiment, 3 runs each:** at `low`, 0/3 in every run. At `medium`, `top-stations` and
    `ifta-by-state` passed 3 of 3; `flagged-fills-drivers` called `odometer_accuracy` instead, 3 of 3,
    and said so ("the closest measure I have"). Cost on these questions: $0.0005 → $0.0014 an answer.
  - **`top_risk`'s description sharpened** (what "flagged" means: high/critical anomaly fills, per
    driver or vehicle): 0 of 3, the same `odometer_accuracy` answer saying it "can't see a flagged
    fills count by driver". Reverted, because a change to what the model reads with no measured
    effect would only blur the next baseline.
  - **Built:** effort `medium` (`askData.ts`), the R2 choice of `low` reversed on this evidence.
  - **Open:** `flagged-fills-drivers`. The model refuses a tool whose description matches; the next
    step is to read its thinking for that one question, not to guess at wording.
  - **Shipped on the owner's word** ("set this on medium as default"), before the full set was re-run.
    So `baseline.json` is still the `low` run, and whether any of its 20 passes regressed at `medium`
    is not yet measured. Next: re-run and re-record the full set at `medium` (~$0.06, owner's go).
  - **Full set re-run at `medium` (owner's go, 2026-11-11): 21 of 23**, then **22 of 23** after one routing fix,
    re-recorded in `baseline.json` ($0.029). `follow-up-month-before` ("and the month before?" after a fuel
    spend answer) had moved to `finance_report` in 3 of 3 runs: `finance_report`'s description claimed
    "fuel" among its families, and `fuel_report`'s did not say "fuel spend". Both descriptions now route
    fuel spend, gallons and price to `fuel_report` (3 of 3 after; `cost-per-mile` and
    `spend-and-mpg-last-month` still pass).
  - **Why `flagged-fills-drivers` still fails — found, not fixed.** With the model's turn printed, the
    response holds a `server_tool_use` of `tool_search_tool_regex` (pattern `fill|fuel|flag`) and a
    result of 5 tools — `card_holds`, `count_signal`, `finance_report`, `fleet_summary`,
    `fuel_economics` — without `top_risk`, then the refusal. Our request declares no tool search and no
    `defer_loading` (checked: no mention in `apps/api/src`, `packages/shared/src`, or `lib/anthropic.ts`),
    and the tool-search docs describe it only as opt-in; 5 is that tool's documented default result cap.
    So the API searched our 25 tools on its own and the cap cut `top_risk` off. This likely explains
    the `low`-effort refusals too (the model searched once and stopped). **Not verified:** why the API
    searches undeclared, and whether a request setting can keep every tool loaded. Next: ask Anthropic
    support with this trace (no carrier data in it), rather than renaming tools to win a 5-result cut.
- 2026-11-11 — **R4b for the four tools linked bare: what each page can hold, and the Idling link.**
  Checked each page's URL state against what its tool answers:
  - **Idling** (`idle_report` → `/idling`): the page already keeps `from`/`to` as calendar days, the days
    `readFleetIdleVerdict` reads for the tool, so its headline for a linked window is the answer's
    `total`. **Built:** `idlingLinkContract.ts` (`IDLING_QUERY_KEYS`, `idlingToQuery`); the page reads its
    keys from it; the tool links the answer's whole period (not the previous period, not a week).
    Tests: `assistantIdleReport.test.ts` "links the Idling page on the answer's whole period, inclusive
    days, built by its contract"; `IdlingPage.test.ts` "opens on the days a link built by its contract
    names (F21 R4b, Ask AI's idle_report)". Deliberate breaks, each killed: the page reading another
    key, the tool linking the previous period.
  - **Annual inspections due** (`annual_inspections_due` → Shop, `/shop`): right page — the list is the
    Shop's `annual` tab (`ShopAnnualDuePanel`), which reads `kind`. Buildable: `tab=annual` plus `kind`,
    with the tool's `truck` written as the page's `tractor`. Next PR.
  - **Repair cost** (`maintenance_cost` → Trucks & trailers, `/shop/units`): the list shows no cost, so
    no link can show the answer. Stays bare; the honest page is a unit's own cost view, if one is wanted.
  - **Live fleet** (`fleet_now` → Dashboard): the Dashboard keeps no filter in its URL. Stays bare until
    the map's state filter is URL state (map work, not Ask AI's).
- 2026-11-11 — **R4b: "Open in Shop" for annual inspections opens the Annual due tab on the asked kind.**
  - `shopAnnualDueLinkContract.ts`: `tab=annual` (`SHOP_QUERY_KEYS`, `SHOP_ANNUAL_DUE_TAB`) and `kind`
    (`ANNUAL_DUE_QUERY_KEYS`, `ANNUAL_DUE_PAGE_KINDS`). Without the tab the Shop opens on the first list
    with rows, often Roadside repairs or Defects. The tool's `truck` is the page's `tractor`;
    `annualDuePageKind` is that mapping, once, and the tool now narrows its own answer with it too, so
    the answer and the link cannot narrow differently.
  - The Shop page reads its tab key and the panel its kind key and options from the contract.
  - Tests: `assistantAnnualDue.test.ts` "links the Shop's Annual due tab on the asked kind, in the page's
    word, built by its contract"; `ShopBacklogPanels.test.ts` "narrows to the kind a link built by its
    contract names: Ask AI's 'truck' is the page's tractor (F21 R4b)"; `MaintenanceHomePage.test.ts`
    "opens on Annual due when a link built by its contract names it, though another tab has rows (F21
    R4b)".
  - Deliberate breaks, each killed: the contract writing the tool's word, the panel reading another key,
    the page reading another tab key.
  - **R4b is now complete for every tool whose page can show the answer.** `maintenance_cost` and
    `fleet_now` stay bare, for the reasons in the entry above.
- 2026-11-12 — **Answer time measured (Step 2d's gate): median 7.3 s, so streaming is built.**
  - Production had one recorded answer (5.0 s, 3 rounds), too few to decide on. The eval now times each
    whole answer around `askData`, as `routes/ai.ts` records `latency_ms`, and reports the median, p90 and
    slowest by nearest rank (`EvalRun.latency`, recorded in `baseline.json`). Test: `assistantEval.test.ts`
    "times each whole answer around the endpoint's own loop, and reports the median and p90 by nearest rank".
  - **Run on production, Haiku 5.5 at `medium`, 23 questions ($0.028, owner's go):** median **7.3 s**, p90
    **15.9 s**, slowest **20.3 s** (`ifta-by-state`). Single-tool answers sit at 3–7 s, while every answer
    with two or more tool rounds takes 10–20 s. The two no-tool refusals take ~2–3 s.
  - **Decision: build Step 2d.** The bar was a median over ~5 s. Because most of the wait happens before the
    first word, during the tool rounds, streaming the text alone would not shorten it. So the stream also
    sends one progress event per tool call (the tool's plain label, e.g. "Reading the fuel report"), and the
    acceptance check becomes "first event under 2 s, measured on staging".
  - **Score 21 of 23 (was 22).** `flagged-fills-drivers` still fails, for the tool-search reason above.
    `loads-per-truck` called the right tool but its answer named neither McLeod nor miles, which is a
    wording check. It passed in the previous run, so this is run-to-run variation, not a code change
    (nothing it reads changed). It stays in the set as recorded.
- 2026-11-12 — **Step 2d built: Ask AI streams its answer, with a step for each report it reads.**
  - **The route.** It stays `POST /api/ai/ask`; a reader that sends `Accept: text/event-stream` gets
    Server-Sent Events. The planned `POST /api/ai/conversations/:id/messages` waits on Step 3b, because
    conversations do not exist yet. One route also means an older web, which sends no such header,
    still gets JSON while the two deploy apart. A refusal before the model is reached (400, 403, the
    429 budget) is still a JSON status. Wire and events: `assistantStreamContract.ts`.
  - **Events:**
    - `step`: the report being read, in the office's words (`ASSISTANT_TOOL_STEP`, a `Record` over every
      tool, so a new tool cannot ship without one).
    - `text`: the answer's words.
    - `done`: the whole answer and its links, the same object the JSON route returns. It is the record.
    - `error`: a model failure after the stream began.

    A step clears text streamed before it, because that text was the model's preamble to a tool call.
    The usage ledger and the `ai.ask` audit row are written exactly as for JSON. A reader who closes
    the tab mid-answer does not stop it, so its cost is still counted.
  - **Buffering.** `compression` would hold the stream to deflate it. `Cache-Control: no-transform`
    keeps it off the response, and a flush after each event is a second guard. `X-Accel-Buffering: no`
    asks a proxy in front to pass events straight on. The route test sends `Accept-Encoding: gzip, br`
    through the real app, and holds the answer until the test has read the first event off the wire,
    so a buffered stream times out. Deliberate breaks:
    - Both guards removed: killed (timeout).
    - `no-transform` removed: killed (the response came back `br`-encoded).
  - **The loop.** `askData` asks each round with `messages.stream` and reads `finalMessage()`, the same
    `Message` `create` returned, so every stop-reason path is unchanged. `fetchAllPaged` and `nameMaps`
    moved to `askReads.ts` to keep `askData.ts` under the 500-line budget.
  - **The web.** `apiFetch` gained a `stream` option, so sign-in, step-up and the access-changed path
    stay in one place. A pending turn shows the current step, then the words, which `done` replaces.
    The draft sits under `aria-busy`, so a screen reader reads the finished answer once rather than
    every fragment. A stream that ends with neither `done` nor `error` is "cut off", and like a
    dropped connection it can be retried.
  - **Tests:**
    - `ai.test.ts`: "sends each event the moment it happens, through the app's compression: the answer
      waits on the reader having seen the first".
    - `assistantStreamContract.test.ts`: "reads back exactly what the route wrote, however the network
      cuts the bytes".
    - `assistant.test.ts`: "shows the report being read, then the words as they come; a step drops the
      preamble before it; done is the record".
    - Store breaks killed: a step that keeps the preamble, a cut-off stream taken as an answer.
  - **Acceptance not yet measured:** first event under 2 s. The eval now records `firstEventMs` per
    answer and its median and p90. One run on production (~$0.03, owner's go) gives the figure; the
    staging check is the owner's walk.
- 2026-11-12 — **Step 3a finished: the dock's design-contract entry, its two remaining states, and a
  browser spec.**
  - The launcher and the non-modal dock have shipped since the redesign. What 3a's acceptance still lacked:
    - **States.** A spent budget (429) and a refusal of access (403) showed in red with "Try again",
      which could only be refused the same way. Such a turn is now `final` (`finalRefusal` in the
      store): the API's sentence, which already says when the budget resets, as a notice with no
      retry. A 503 or a dropped connection keeps "Try again".
    - **Design contract.** §6.4, "The one non-modal panel". It covers why the dock is non-modal, its
      layer below every dialog, its size at 390 px, the header's actions, the keyboard, each state and
      the motion.
    - **Browser spec.** `e2e-apply/assistantDock.spec.ts`, against the built app in CI. It is signed in
      by writing a session where supabase-js keeps it: the app decodes its token and never verifies
      it, so this needs no build flag. It covers:
      - keyboard only: Ctrl+J, focus in the question, a streamed answer, Escape back to the launcher;
      - a spent budget with no "Try again";
      - a 390 px phone with reduced motion: the dock fits, the question box is above the fold, and the
        entrance is stilled.
  - **Found while writing it.** `test.use({ reducedMotion })` did not reach the page, and the first
    motion check passed only because it read the duration after the entrance had ended. The spec now
    emulates on the page and reads mid-entrance. Deliberate breaks, killed: motion allowed (the
    stilled-entrance check failed), "Try again" restored on a spent budget.
  - **Not covered:** a screen-reader pass by ear. The `aria-busy` draft and `aria-live` thread are as
    designed, but no one has listened to them. That belongs in the owner's live test (Q-AI8).
  - Next: Step 5 (`open_view`, navigation). 3b is not built: Q-AI4 (c) keeps conversations tab-local
    until somebody asks for them.
- 2026-11-12 — **Step 5, first slice: `open_view` opens Fuel problems filtered, behind the dock.**
  - **One tool, gated per page.** A navigation reads no figures, so `open_view` is one tool over several
    pages (`ASSISTANT_VIEWS`, `assistantViews.ts`), not a tool per page; fewer tools also matters while
    the API's own tool search cuts at 5 (§6, 2026-11-11). Whether a caller is offered a page is that
    page's own surface gate (`canReachSurface`), the sidebar's answer, so `open_view` declares no
    section of its own. The tool's definition lists only the caller's pages. The web asks
    `surfaceAllowed` as well before it moves, the same two checks as an "Open in …" link.
  - **Filters through the page's contract (D-AI6).** `fuelProblemsLinkContract.ts` holds the page's
    keys: `state`, `kind`, `owner=me`, and the window and trucks as Fuel costs spells them. The page reads
    them from it. The model's filters are a STRICT schema built from the page's own lists. An unknown key
    or a value outside the page's list fails, and the error names what the page can filter by: refused,
    not dropped (the acceptance). Unit numbers become vehicle ids only in the link (D-AI8). A unit not in
    the fleet opens nothing.
  - **Navigation (D-AI5 (a)).** Only `open_view`'s link is marked `navigate`, by `splitAssistantLink`,
    never by a tool's result. The dock (`useOpenView`) follows it once, when the newest turn lands, and
    the dock stays open over the page. On `/ask` nothing moves; the answer's "Open in …" link is the way
    there.
  - **Current page.** Each question carries the surface behind the dock (`page`). The API names it to the
    model after the cache breakpoint, so "filter this to 718" knows what "this" is. An unknown key is
    ignored.
  - **Not met yet:** the acceptance question's "over $200" has no filter on the page. Q-AI14 asks, with a
    recommendation.
  - **Tests:**
    - `assistantViews.test.ts`: "refuses a filter the page does not have, naming what it can filter by,
      rather than dropping it".
    - `openAssistantView.test.ts`.
    - `askData.test.ts`: "tells the model the page the person is on, offers open_view with their pages,
      and marks its link to navigate, ids off the model's text (Step 5)".
    - `useOpenView.test.ts`: "sends the page the person is on, and opens the page an answer opened, with
      its filters, once".
    - The eval set gains `show-open-fuel-problems`. It is not yet run (~$0.03 on the owner's go).
  - **Deliberate breaks, each killed:**
    - the schema passing unknown keys;
    - every tool's link navigating;
    - the dock moving on `/ask`.
  - **Next, one page per PR:** Fuel log, Alerts (`/anomalies`), Fuel cards, Drivers; then Loads and
    Vehicles, which first need their filters in the URL (S4).
- 2026-11-12 — **Step 5, second page: `open_view` opens the Fuel log filtered.**
  - **The page's contract.** `fuelLogLinkContract.ts` now holds the Fuel log's URL: the tab (`fills`,
    `declines`, `source`), the shared `from`/`to`/`unit`, and the three facets a link may set, each with
    the tab that owns it (`tank` on Fills; `risk` on Declines; `state` on Declines and Source). The page
    reads all of them from it (`useFuelLogFilters` and the three tabs), and the CSV export route reads its
    tank and risk lists from it too, so the page, its export and Ask AI cannot name different values.
  - **Trucks are unit numbers here, not ids.** The Fuel log's `unit` key carries unit numbers because two
    of its tabs read EFS tables keyed on the unit as text (FUEL-P1). `openAssistantView` resolves the
    model's spelling ("#718", "Unit 751") against the fleet and writes the fleet's own spelling. A unit
    not in the fleet opens nothing, as on Fuel problems.
  - **A facet on the wrong tab is refused.** The page clears a facet on any tab but its own, so Fills'
    `tank` on Declines would open a list wider than the answer says. The schema refuses it and names the
    tab that has the filter. It does not move the link to that tab on the model's behalf.
  - **Not offered, on purpose:** the driver filter, free-text search and sort. `driver` is a driver id on
    Fills and a card-printed name on the two feeds, so it needs a name→id rule that does not exist
    yet. A driver filter is refused and the model is told what the page can filter by. That is the
    contract's refusal, not a gap in the page.
  - `openAssistantView` builds links in an exhaustive `switch`: a view added without its branch does not
    compile.
  - The dock suggests "Show me the high-risk declines from the last 7 days" on the Fuel log.
  - **Tests:**
    - `assistantViews.test.ts`: "Fuel log: a tab's own facet is refused on another tab, naming the tab
      that has it, never moved there"; "Fuel log: writes the page's own keys, trucks as unit numbers
      under `unit`, the default tab left out".
    - `openAssistantView.test.ts`: "opens the Fuel log's declines on the asked trucks, writing each unit
      as the fleet spells it, never an id".
    - `useFuelLogFilters.test.ts`: "lands a link built by the contract as the tab, window, trucks and the
      tab's own facets it names"; "opens on Fills with the tank a link names, and a tab change drops the
      facet it owned".
    - The eval set gains `show-declines-fuel-log` (dispatcher). It is not yet run; it goes in the same
      run as `show-open-fuel-problems` (~$0.03 on the owner's go).
  - **Deliberate breaks, each killed:**
    - no facet-to-tab check;
    - the model's unit spelling written into the link;
    - the page reading its trucks from another key.
  - **Next:** Alerts (`/anomalies`, `safety.alerts`), then Fuel cards, then Drivers.
- 2026-11-12 — **Step 5, third page: `open_view` opens Fuel alerts (`/anomalies`) filtered.**
  - **The page's contract.** `fuelAlertsLinkContract.ts` holds the page's URL:
    - `vehicle` (vehicle ids, singular name kept for forwarded deep links), `status`, `severity`,
      `from`/`to` and `reefer=1`;
    - the page's four statuses plus `all`, and `ANOMALY_SEVERITIES`.
    - The page (`useAnomaliesPage`) reads it. So does the Fuel log's "Flagged" tile (`flaggedCasesLink`),
      which built the same URL by hand.
  - **"Every status" is `all`, never absence.** Without a status the page shows the open queue, or a named
    truck's whole history. A link that means every status writes `all`, as the page's own control does
    (FUEL-C3).
  - **One severity, one status.** The page's controls are single-choice, so "high or critical" has no
    address. The view's schema takes ONE severity and ONE status. A list is refused, and the model says
    the page shows one at a time. It does not open a wider list.
  - Trucks become vehicle ids in the link (the page filters `anomalies.vehicle_id`). The Fuel log is the
    one view that takes unit numbers.
  - The dock suggests "Show me the critical alerts that are still open" on Fuel alerts.
  - **Tests:**
    - `assistantViews.test.ts`:
      - "Fuel alerts: one status (or `all`) and one severity, as the page's single-choice controls; two
        severities are refused";
      - "Fuel alerts: writes the page's own keys, trucks as vehicle ids under `vehicle`, every status as
        `all`, never as absence".
    - `openAssistantView.test.ts`: "opens Fuel alerts on the asked trucks as vehicle ids, the severity and
      status as the page reads them".
    - `anomaliesFiltersInUrl.test.ts`: "lands as the trucks, status, severity, window and reefer view it
      names".
    - Eval case `show-critical-alerts` (safety manager). Not yet run.
  - **Deliberate breaks, each killed:**
    - severity accepting a list;
    - `all` written as absence;
    - unit numbers where the page reads ids;
    - the page reading the reefer view from another key.
  - **Next:** Fuel cards, then Drivers.
- 2026-11-12 — **Step 5, fourth page: `open_view` opens Fuel cards filtered.**
  - **The contract grew from one key to six.** `fuelCardsLinkContract.ts` (R4b: `status` only) now holds
    `status`, `unit`, `policy`, `override`, `linked` and `health`, with the three yes/no vocabularies. The
    page reads every one of them from it. `card_holds`' status-only link is unchanged.
  - **One value per filter.** Every control on the page is single-choice, so the schema takes ONE `unit`
    (not a list) and one of everything else. "Cards for 718 and 751" is refused.
  - **The unit is the card's EFS unit prompt**, matched exactly by the page. The model's spelling
    ("Unit 718") becomes the fleet's ("718"), as on the Fuel log. A card whose prompt EFS spells
    differently from the fleet (say "0718") is not matched by the page either. The link shows what the
    page shows for that truck; it does not guess.
  - **Not offered:** the card's driver name and free-text search. They have no rule yet for turning a
    person's name into the card's spelling (the same reason as on the Fuel log).
  - The dock suggests "Show me the cards with an active override" on Fuel cards.
  - **Tests:**
    - `assistantViews.test.ts`:
      - "Fuel cards: one value per filter, as the page's single-choice controls; the card's driver name is
        not a link filter";
      - "Fuel cards: writes the page's own keys, and the status-only link card_holds already sends is
        unchanged".
    - `openAssistantView.test.ts`: "opens Fuel cards on ONE truck as the fleet spells its unit, with the
      page's own facets".
    - `fuelCardsFiltersInUrl.test.ts`: "narrows the table to the unit and facets a link built by the
      contract names".
    - Eval case `show-cards-with-override`. Not yet run.
  - **Deliberate breaks:**
    - Killed:
      - the cards schema passing unknown keys;
      - the model's unit spelling written into the link;
      - the page reading `policy` from another key.
    - **Survived the first time:** the page reading `linked` from another key. The page test linked
      `unit=202` with the facets, and the unit alone already narrowed the table to that row, so the facets
      did no work. The test now opens one link per facet, each of which must narrow the two rows to one.
      Killed on the rerun.
  - **Next:** Drivers (`fleet.drivers`; `driversLinkContract.ts`), then Loads and Vehicles, which first
    need their filters in the URL (S4).
- 2026-11-12 — **Step 5, fifth page: `open_view` opens the Drivers roster filtered.**
  - **The contract grew from two keys to seven.** `driversLinkContract.ts` (R4b: `file`, `status`) now holds
    the roster's search (`q`), the qualification horizon (`due`), the one-requirement narrowing (`req`),
    `seat=none` and `show=archived`. `useRosterFilters` reads every key from it.
  - **`status` keeps its three spellings.** Absent is the roster's default: active on the live roster, every
    status on the archived one. `any` means every status. A named status is that status. The contract writes
    absence only when the link says nothing, and the view's `any` becomes `null`, which the contract writes
    as `any`. `driver_file_expirations`' link is unchanged.
  - **The values are the roster's own lists:** `DRIVER_STATUSES`, `FILE_FILTERS`, `DQ_DUE_FILTERS` (without
    the "any time" blank, which a link says by leaving `due` out) and `DQ_ROSTER_COLUMN_KEYS`. The view's
    description says `file` is the driver's WORST chip (Q-AI13). So "drivers with something expiring"
    opens `file=expiring` only as the roster means it, and for one requirement the model has `due` +
    `requirement`, which is per item.
  - **No truck filter.** The roster has none, so "drivers on 718" is refused, naming what the roster can
    filter by.
  - **Who is offered it is the surface's own gate (`section("roster")`).** That gives the recruiter the
    roster and nothing fuel, as the matrix says. The technician is offered no page.
  - The dock suggests "Show me the drivers whose medical card is due in the next 30 days" on Drivers.
  - **Tests:**
    - `assistantViews.test.ts`:
      - "Drivers: the roster's own vocabularies, one value each; `any` is every status, and a truck is
        not a roster filter";
      - "Drivers: writes the roster's own keys; status left out opens its default, `null` writes `any`,
        and card_holds-era links are unchanged".
    - `openAssistantView.test.ts`: "opens the Drivers roster with the qualification filters as the roster
      reads them, `any` for every status".
    - `useRosterFilters.test.ts`: "reads every other filter a link built by the Drivers contract names".
    - Eval case `show-medical-due-drivers` (safety manager). Not yet run.
  - **Deliberate breaks, each killed:**
    - an absent status written as `any`;
    - `any` dropped to absence by the view;
    - the roster reading `due` from another key.
  - **Step 5's link-contract pages are done:** Fuel problems, Fuel log, Fuel alerts, Fuel cards, Drivers.
    Next are Loads and Vehicles. Their filters are not in the URL yet (D-AI6/S4), so each first gets its
    filters into the URL, as a page PR of its own, before it can be a view.
  - **Waiting on the owner:**
    - one eval run (~$0.03) covering the six `open_view` cases;
    - Q-AI14 (an amount filter on Fuel problems).
