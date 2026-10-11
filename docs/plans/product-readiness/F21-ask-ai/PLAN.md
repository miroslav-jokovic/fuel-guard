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

## 6. Log

- 2026-10-08 — Audit and plan written. Use measured (15 asks, 3 people, ever). Research:
  enterprise assistant patterns, browser speech support, STT and Claude pricing.
