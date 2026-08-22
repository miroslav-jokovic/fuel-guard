# Handoff · 2026-08-21 night — the application system is finished; the next work is R-side

Supersedes `HANDOFF-2026-08-21-EVENING.md`, which pointed at A8. Everything it pointed at is done.
Deliberately short, on that document's own model: the plans are the memory, this says where to stand,
what shipped, and the things that cost time so they cost it once.

## 1. Where to stand

1. Run **`RECRUITING-SYSTEM-PLAN.md` §4's resume ritual** — unchanged, and still the protocol for
   every session. `APPLICATION-SYSTEM-PLAN.md` is now a **completed** document: read it for its
   decisions and its corrections, not for work.
2. `git log --oneline -15` and `pnpm verify:live` before believing anything about deploy state.
3. **Migration head: `0233`.** Live and verified 2026-08-22T00:49Z: commit `239778b`, schema 0233,
   `verify:live` clean.
4. Never pin migration numbers — next-numbered at execution.

## 2. What shipped (A8 → A11b, all live, all marked DONE in the plan)

| Step | What it did | Migration |
|---|---|---|
| A8a | Staged captures, promoted into `documents` at submit | 0230 |
| A8b | The drawn signature mark, found again through A8a's identity property | — |
| A9 | The carrier's questions as versioned data — **plus two contract corrections** | 0231 |
| A10 | One nudge back to a driver who walked away | 0232 |
| A11a | The retention rule that makes "prunable" true | — |
| A11b | SMS as the consent regime it actually is | 0233 |

**`APPLICATION-SYSTEM-PLAN.md` A0–A11b are ALL DONE.** A3b (prefill) is deliberately out of the line
and blocks nothing.

## 3. ⚠ Six places the plan's own text was wrong or unbuildable

Each is folded into the plan in place with ⚠ and its reasoning. **Do not re-litigate these; do read
them before touching the same ground.**

1. **A8's promotion could not extend `submit_driver_application` with `create or replace`** — see §5.
2. **A9: the driving-experience grid is §391.21(b)(6), not a carrier question.** (b)(6) names the
   equipment types itself, and **FMCSA's own sample application** lays it out as exactly that grid —
   the owner's packet is a near-verbatim copy of the government's form. It moved into the regulated
   contract, and a cross-field rule now refuses a document answering neither half of the paragraph,
   which the schema previously accepted.
3. **A9: aliases are NOT §391.21 material.** (b)(2) is "name, address, date of birth, and social
   security number" and FMCSA's form asks for no other name. ⚠ Search results claiming the FMCSRs
   require aliases are **wrong**. They are §391.23(a)(2) material — projected onto `drivers` and into
   the inquiry letter, which is the only reason to collect them.
4. **A9: no `required` flag on questionnaire questions.** Enforced in the wizard alone it breaks A3's
   "client validates with the server's own object"; enforced in the schema it lets a carrier's
   question refuse a §391.21 application.
5. **A10: "here is your link back" is unbuildable.** The plaintext token was never stored (0220 keeps
   a SHA-256). Issuing a new invitation — the repo's existing answer to a lost link — resumes an
   EMPTY form, because drafts are one per invitation. **The token is rotated in place.**
6. **A11b: no area-code timezone table.** An area code says where a number was issued; portability
   makes it a confident wrong answer, and wrong is billed per message. Known timezone when we have
   one, otherwise only the window civil in every US timezone at once.

⚠ **And one number that is ours, not the law's:** the SMS send window is 9–20. §64.1200(c)(1) permits
8–21. The margin is deliberate and the constants say so.

## 4. How this session worked — keep doing this

- **One step (or named sub-step) per branch** `claude/<topic>` → PR → wait for CI → merge with a merge
  commit → `pnpm verify:live` → confirm `migrate.yml` went green. Never direct-merge `main`.
  A8, A11 were both **split** into a/b on A3's precedent when they bundled unrelated work.
- **Read the primary source, not a summary of it.** This session that meant: §391.21(b) verbatim on
  Cornell LII, 47 CFR §64.1200 verbatim, and **FMCSA's own sample driver employment application**
  (`csa.fmcsa.dot.gov/SafetyPlanner/documents/Forms/Drivers_Employment_Application_508.pdf` — a PDF;
  `pdftotext -layout` reads it). Two of the six corrections above came from that one PDF.
  ⚠ **ecfr.gov still redirects to a bot-check and cannot be fetched.** Cornell LII works.
- **When a step's text is wrong or unbuildable, say so in the plan and do the right thing.**
- **Say what was not verified**, in the PR and in the plan.
- **Gates before every PR:** `pnpm test`, `pnpm typecheck`, `pnpm lint`, plus `lint:filesize`,
  `funcsize`, `migrations`, `rls`, `upserts`, `tests`, `secrets`, `boundaries`, `comment-claims`,
  `tokens-parity`, `ui-adoption`, `ui-contrast`, and `pnpm --filter web lint:tokens`.

## 5. Harness facts that cost time — each presented as something else

- ⚠ **`create or replace function` with an EXTRA PARAMETER creates a second overload, not a
  replacement.** Postgres identifies a function by (name, argument types). A later call naming the
  old argument list then matches BOTH and fails as ambiguous. 0230 drops the old signature explicitly
  and gives the new parameter a DEFAULT, so a migration landing before its code still works; the API's
  half is to OMIT the parameter when it has nothing to pass. 0231 is a genuine `create or replace`
  because its signature is unchanged — check which you are doing.
- ⚠ **`{...URL}` in a test yields a plain object, and `new URL(...)` stops existing process-wide.**
  Cost a green local run and a red CI one: Node 26 (local) did not need the constructor in that path
  and Node 22 (CI) did. Spy on the one static you need; never spread a class. **CI is Node 22.**
- ⚠ **`env.test.ts` reads `env.ts` as TEXT** to classify defaults. Splitting the schema across files
  silently un-covers every key that moved — its own self-check caught it, which is what that check is
  for. It reads both halves now; a third file needs a third entry.
- ⚠ **PGlite `now()` is the transaction timestamp and statements run microseconds apart.** An
  assertion that `greatest(expires_at, now() + 14 days)` EXTENDED a 14-day link is about clock
  resolution, not behaviour. Give the fixture a genuinely shorter window.
- ⚠ **`supabaseRecorder`'s default storage stub returns `{ data: { path } }` for ANY method** —
  including `download`, whose caller then does `.arrayBuffer()` on an object that has none. Script
  `download` explicitly when a path reads bytes.
- **Existence checks in Storage: `list(dir, { search: name })`, not `info()`.** `list` is the oldest
  call in the API and cannot break on a Storage version we did not choose.
- ⚠ **The Bash tool's cwd persists between calls.** A `cd packages/shared` earlier in the session made
  a later `cat > packages/shared/src/…` write nothing. Prefer absolute paths for heredocs.
- **`pnpm lint` scans `.claude/worktrees/`** — still true. Filter with
  `pnpm lint 2>&1 | grep -E "^/Users" | grep -v "\.claude/worktrees"`.
- ⚠ **A stale Railway build log is not a current failure.** One from 2026-08-19 (a `BaseCheckbox.vue`
  import since fixed) resurfaced during this session. `pnpm verify:live` is the authoritative answer,
  and **CI runs `pnpm build`** (`ci.yml:97`), so a broken web build cannot reach Railway through a PR.

## 6. Clocks that run outside the code — raise them, do not wait on them

- **A0 — counsel.** The highest-leverage item left in the whole application system, and it is now a
  **review** pass: the owner's packet already contains its own FCRA disclosure, previous-employer
  release, driving-record authorization and drug-testing consent (plan §6.1 pile 3). ⚠ **Publishing
  the reviewed text arms three gates at once — the 7001(c) consent, the signing ceremony, and the SMS
  consent — with NO deploy**, because all three gate on a version string. Two things to put to counsel
  explicitly: the packet's page-4 "Independent Contractor Notification & Release" bundles a
  consumer-report disclosure with a liability release, which is what §604(b)(2)'s "solely the
  disclosure" forbids; and it names the wrong consumer-reporting agency.
- **10DLC brand/campaign registration** — opened 2026-08-21. Until it completes `SMS_PROVIDER=none`
  and A11b is inert by design. ⚠ Its transport and inbound signature check have **never touched the
  wire** — the first real message is the first real test.
- **The carrier's legal address** — value known (`1301 Armitage Ave, Melrose Park, IL 60160`), column
  exists (0229). One production `update organizations set legal_address = …`, an owner act.
- **Clearinghouse owner acts** (R5) — query-plan purchase is employer-only; from 2026-04-27
  registration needs IDEMIA identity verification.

## 7. What to do next

`APPLICATION-SYSTEM-PLAN.md` is finished. The open work is **`RECRUITING-SYSTEM-PLAN.md` §5**, where
R2b now points back at the completed child plan. In its own order: **R1 (leads)** is the first step
with nothing in front of it, and it is also what finally gives `sms_consents` its `lead_id` and the
questionnaire its prefill source (D-APP14, A3b). R3 (MVR) needs only demo Samba credentials.

⚠ **One standing caution that outranks the step order: nothing in A1–A11b has been exercised in a
browser or against a real inbox.** The apply page is session-free and needs a real minted invitation
to reach, so every step is proved by component tests that mount the real page and service tests
against a recorder. The flow now spans a consent gate, a four-instrument ceremony, seven screens,
staged photographs and a rendered PDF. **Walk a test invitation through the whole thing in the
`FuelGuard EFS QA` org before a real candidate meets it** — that is worth more than the next feature.

## 8. Standing cautions

- QA happens in the `FuelGuard EFS QA` org (`07fe4058-…`, null `dot_number`) — never Silvicom.
- The public apply surface has **two stacked rate limiters** (`app.ts`); the budget is the
  intersection, **20/min**. A2's autosave holds a floor of one save per 5 s for that reason.
- Production writes go through the owner in the Supabase SQL editor; `supabase db query --linked` is
  for reads.
- `docs/McLeod-Testing/` is still untracked in the working tree — not this work's; leave it.
