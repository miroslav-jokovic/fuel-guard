# Handoff · 2026-08-21 evening — A1–A7 shipped, next step is A8

Deliberately short. The plans are the memory; this page says where to stand, what shipped today, and
the things that cost time so they cost it once.

## 1. Where to stand

1. Run **`RECRUITING-SYSTEM-PLAN.md` §4's resume ritual** — unchanged, and it is still the protocol
   for every session. Then read `APPLICATION-SYSTEM-PLAN.md` top to bottom (its §5 register is
   current), then the `CLAUDE.md` of every package the step touches.
2. `git log --oneline -15` and `pnpm verify:live` before believing anything about deploy state.
3. **Migration head: `0229`.** Live and verified: commit `7f4550b`, schema 0229.
4. Never pin migration numbers — next-numbered at execution.

## 2. What shipped today (all live, all marked DONE in the plan with "What shipped" / "Verified by:")

| Step | What it did | Migration |
|---|---|---|
| A1 | The link stopped being a fuse — three phase stamps, §0.2's defect closed | 0225 |
| A2 | Drafts + autosave, gated by D-APP16's DOB unlock | 0226 |
| A3a | Seven-screen wizard, §391.21(b) citations corrected, a silent field-drop fixed | — |
| A4 | §390.32(d)'s proof of 15 U.S.C. 7001(c) consent, as six statutory clauses | 0227 |
| A5 | The signing ceremony — four instruments, four rows, the fourth closes the phase | 0228 |
| A6 | The rendered §391.21 PDF, plus `used_at` dropped and `legal_address` added | 0229 |
| A7 | The web capture provider — a bad photograph never reaches the network | — |

**A3b (prefill) is deliberately out of the line** and blocks nothing; see its entry.

⚠ **Everything the driver signs is inert until A0.** The consent gate (A4) and the ceremony (A5) both
arm themselves off the disclosure version string, so today the link behaves as it did before and the
day counsel's text is published the whole flow turns on with **no deploy**. That is by design: a gate
nobody could pass would have taken a working production capability offline.

## 3. The next step is A8 — staged captures, filed at submit

A7 built the provider; A8 gives it slots, a staging table and an upload. Its plan entry is accurate.
Three things in it are easy to get wrong:

- ⚠ `submit_driver_application`'s live body is **0229's** now (0225 → 0229 as `used_at` was dropped).
  Extend that one, never an older file's.
- The staging bucket is separate from `documents` on purpose: a candidate who never submits must
  leave nothing in an evidence bucket.
- A8 is also where **the drawn signature mark** finally has somewhere to live (A5 shipped adoption
  with the typed name only, because a canvas whose output is discarded is worse than no canvas).

Then A9 (the questionnaire — its input arrived, see §6.1 of the plan), A10, A11.

## 4. How this session worked — keep doing this

- **One step (or named sub-step) per branch** `claude/<topic>` → PR to `main` → wait for CI → merge
  with a merge commit → `pnpm verify:live` → confirm the migration workflow went green. Never
  direct-merge `main`.
- **Read the regulation, not the plan's summary of it.** Doing that corrected the plan four times
  today: §391.21(b)(4)/(b)(5)/(b)(1) were crossed (A3a), 7001(c) turned out to be six enumerated
  clauses rather than a paragraph (A4), and §383.21 explained why a licence list is normally empty
  (A3a). Cornell LII works; **ecfr.gov redirects to a bot-check and cannot be fetched.**
- **When a step's text is wrong or unbuildable, say so in the plan and do the right thing.** Five
  deviations today, each folded in place with ⚠ and a reason: A4's gate armed by A0 rather than A4,
  A5 deferring the `used_at` drop, A6's impossible footer hash, A6's retry-without-a-queue, A7's
  unmeasurable thresholds. **Corrections go in the document, marked ⚠ — the chat is not the memory.**
- **Say what was not verified.** The apply page is session-free and needs a real minted invitation to
  reach, so none of A1–A7 was checked in a browser; component tests mount the real page instead. Say
  that in the PR rather than implying a check that did not happen.
- **Gates before every PR:** `pnpm test`, `pnpm typecheck`, `pnpm lint`, plus `lint:filesize`,
  `funcsize`, `migrations`, `rls`, `upserts`, `tests`, `secrets`, `boundaries`, `comment-claims`,
  `tokens-parity`, `ui-adoption`, `ui-contrast`, and `pnpm --filter web lint:tokens`.

## 5. Harness facts that cost time today — each one presented as something else

- ⚠ **`pnpm lint` scans `.claude/worktrees/`** — a live agent worktree inside the repo, i.e. a second
  copy of the codebase linting itself. It produced **701 errors** and zero were real. Check with
  `pnpm lint 2>&1 | grep -E "^/Users" | grep -v "\.claude/worktrees"`; if that prints nothing the
  gate is clean.
- ⚠ **The real 20 req/min rate limiter runs inside the route tests**, and every test in
  `publicApplication.test.ts` shares one Express instance — so the twenty-first request *in the file*
  returns 429 and the failure looks like whatever that test was about. Each call now carries its own
  `X-Forwarded-For`; the limiter has one deliberate test.
- ⚠ **PGlite: `set local role` and `set_config(..., true)` are transaction-scoped.** Outside an
  explicit `begin` they are discarded before the statement runs and it executes as the owner with no
  claims — a test that meant to prove a refusal quietly proves nothing.
- ⚠ **With RLS deny-all and no UPDATE/DELETE policy a client write matches zero rows and SUCCEEDS.**
  Assert the row is unchanged, not that it threw. A guard trigger is proved the way it actually fires:
  a connection that bypasses RLS while carrying JWT claims.
- ⚠ **pdfkit auto-adds a page** for text drawn below the bottom margin, so a footer at the foot of the
  sheet silently doubles the document. Zero `doc.page.margins.bottom` around the write. And its
  content streams are **deflated and hex-encoded** — grepping raw PDF bytes for text finds nothing and
  makes the assertion vacuous.
- **To test a published disclosure**, `vi.spyOn(DOC, "version", "get").mockReturnValue("v1")` — both
  gates open off the version string alone.
- **openpyxl is not installed and pip is PEP-668 blocked.** An `.xlsx` is a zip of XML; stdlib
  `zipfile` + `ElementTree` reads it fine (shared strings then sheet XML).
- **Dropping a column is expand-then-contract**: remove every reader, ship, verify live, then drop —
  and **replace any function that still writes the column in the same migration**, or every call
  raises 42703 at runtime.
- **CI flake, not ours:** `inventoryRoute.test.ts > "STAYS UNDER 29 REQUESTS…"` times out at 5s under
  load (959ms locally). Re-running the identical commit passed. A task chip exists to fix it properly.

## 6. Clocks that run outside the code — raise them, do not wait on them

- **Counsel wording (Q-H3 / A0)** — now a **review** pass, not drafting: the owner's packet already
  contains its own FCRA disclosure, previous-employer release, driving-record authorization and
  drug-testing consent (plan §6.1). Still needed: the six 7001(c) clauses A4 shipped as placeholders
  with a statutory citation each. ⚠ Publishing arms the consent gate and opens the ceremony.
- **The carrier's legal address** — the value is known (`1301 Armitage Ave, Melrose Park, IL 60160`,
  from the packet's letterhead) and the column exists (0229). It needs one production
  `update organizations set legal_address = …`, which is an owner act; until then every rendered
  application is missing §391.21(b)(1)'s address line.
- **10DLC brand/campaign registration** (D-APP13) — opened 2026-08-21 with A1. Multi-week lead time;
  A11 ships with the SMS flag default-off regardless.
- **Clearinghouse owner acts** (R5, later) — query-plan purchase is employer-only; from 2026-04-27
  registration needs IDEMIA identity verification.

## 7. Standing cautions

- QA happens in the `FuelGuard EFS QA` org (`07fe4058-…`, null `dot_number`) — never Silvicom.
- The public apply surface has **two stacked rate limiters** (`app.ts:147` and `:231`); the budget is
  the intersection, **20/min**. A2's autosave holds a floor of one save per 5 s for that reason — keep
  the floor, not just the debounce.
- Production writes go through the owner in the Supabase SQL editor; `supabase db query --linked` is
  for reads.
- `docs/McLeod-Testing/` is still untracked in the working tree — not this work's; leave it.
