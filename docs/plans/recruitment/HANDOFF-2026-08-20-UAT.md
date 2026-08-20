# Handoff — PSP UAT testing · 2026-08-20 (late)

Narrow by design. [`HANDOFF-2026-08-20.md`](./HANDOFF-2026-08-20.md) still holds the recruitment
state; [`HANDOFF-2026-08-19.md`](./HANDOFF-2026-08-19.md) §4 still holds the house rules and harness
facts. **This file is only about exercising PSP in UAT and what that turned up.**

Operator-facing steps live in [`UAT-RUNBOOK.md`](./UAT-RUNBOOK.md). This is the agent-facing version:
what changed, what is still unknown, and what to watch for.

---

## 1. What arrived (2026-08-20, PSP support email)

A UAT account, a token, a test-driver spreadsheet, and a guide. All of it in `docs/psp-docs/`, which
is **gitignored** — the tokens, the confidential guide and the workbook are on the operator's disk
and must stay out of git. `gitleaks` is clean; keep it that way.

| | |
|---|---|
| UAT account | `Silvicom, Inc - UAT`, **motorCarrierId 31496** |
| UAT host | `https://rest-api.uat.psp.tylerapp.com` — **no path prefix** |
| Production host | `https://www.psp.fmcsa.dot.gov/PspRestService` — **with prefix** |
| UAT token | `docs/psp-docs/apitoken-uat.txt` — verified working |
| Production token | `docs/psp-docs/apitoken.txt` — different token, do not mix |
| Logins | `safety@silvicominc.com`, `miki@silvicominc.com` (Login.gov MFA) |

**The attached guide is byte-identical to the v3.9 already analysed** (sha256 matched). Do not spend
context re-reading it. `PSP-PLAN.md` §2.6 still records its five discrepancies against the OpenAPI.

---

## 2. What this session changed

**The carrier-identity fix, which is the one that mattered.** `resolveCarrierIdentity` gave
`organizations.dot_number` absolute precedence and returned `motorCarrierId: null`. Silvicom's org
row holds **1864495** — the real USDOT number, valid in production and nowhere else. UAT is a
different carrier. Every test request would have returned §8.5 **detail 18** with nothing naming the
cause.

The function now takes `environment` and it is **required, not optional** — that is deliberate, and
it is why the compiler found all three call sites instead of one of them being missed. In `uat` the
org row is not consulted; in `production` it wins as before.

**The production interlock.** `PSP_ENVIRONMENT=production` alone no longer allows an order;
`PSP_PRODUCTION_ACKNOWLEDGED=true` is needed as well. Two switches, so a copied `.env` or a wrong
deploy template cannot start spending on its own.

**Two side effects worth knowing.** `screeningReadiness.test.ts` was written when identity was
environment-blind, so its cases were production cases without saying so — they now say so. And
`supabaseRecorder` gained nothing this session, but note from the earlier handoff that it returns its
fixture *regardless of the filters applied*, so an emptiness assertion never proves filtering.

---

## 3. Verified against the live service, read-only

Three probes, none of which mints or bills. `GET /DayMonitored45` is the only endpoint that does
neither — `POST /Records` bills on Success, Partial **and** Failure (§8), and `GET /Token` **mints**,
so it must never be used as a connectivity check.

| Probe | Result |
|---|---|
| UAT token → `https://rest-api.uat.psp.tylerapp.com/DayMonitored45` | **200**, `success:1`, `errorCode:0`, empty report |
| UAT token → `…/PspRestService/DayMonitored45` | **404** — the OpenAPI's `servers` block is wrong |
| Production token → UAT host (2026-08-19) | **401**, `errorCode:32` — environments fail closed |

**`rest-api.uat.psp.typerapp.com` in their email is a typo** for `tyler`app. The failure mode is not
a 404 — an `api-key` header sent to a mistyped domain is a credential handed to whoever registered
it. Nothing in this repo has ever resolved that hostname, and nothing should.

---

## 4. The next session's actual job

Everything is built. **The remaining work is running it and reading what comes back**, in this order:

1. **Set the UAT env** per `UAT-RUNBOOK.md` §5. `PSP_DOT_NUMBER` **unset** — a DOT number and a motor
   carrier ID that describe different accounts is detail 34.
2. **Start with Gary Thomas** (GA `G12345678` + PA `P123456789`, DOB 1974-07-07). He is the only
   two-licence driver in the set, so he is the only way to reach the `Partial` (status 4) path, and
   status 4 is one of the three that bills.
3. **Read `psp_requests.response_raw` before believing anything else.** It is stored whole precisely
   so a wrong projection costs a re-derivation and not a re-purchase.
4. **Then the shape cases**, in rough order of what they would break:
   - **Cases 88–91, "Carrier Information Unavailable"** — inspections with no carrier. The
     cross-match must skip them, not read a null USDOT as an unlisted employer. The types allow null;
     nothing has proved the behaviour.
   - **Cases 15–35, additional DLs** — same licence with a different last name. This is what exercises
     the check that the returned licence matches the one asked for, which is what stops one person's
     history landing on another's file.
   - **Barger (KY) and Litton (PA)** — `notPreventable` crashes (§10.5). A crash FMCSA already ruled
     non-preventable must not be counted against the driver.
   - **Knoll (NT), Cross (ON), Hines (GU), Carter (VI)** — the jurisdictions `PSP_JURISDICTIONS`
     enumerates. They should pass validation and round-trip.

---

## 5. Open questions, and which of them UAT can answer

| | Answerable in UAT? |
|---|---|
| Does `/Records` accept our request shape at all — field names, `M/D/YYYY`, the array wrapper | **Yes.** The first real thing to learn. |
| Does the parser match a real response (five guide/OpenAPI discrepancies, no `required` fields) | **Yes** |
| What `status: 3` actually is — in the OpenAPI enum, in no guide version | **Maybe** — only if a scenario produces it |
| Does `POST /Record` return `%PDF` bytes, or §7.1's `ERROR` string | **Yes** |
| Does the `authCode` really expire at 120 hours | **Yes**, with patience |
| Does `internalRefId` round-trip | **Yes** — the driver-resolution design rests on it |
| What `monitor: true` costs and how enrolment ends (Q5) | **No** — ask support |
| Per-transaction production price (Q2) | **No** — ask support |
| Whether a PSP report is an FCRA consumer report (Q7) | **No** — counsel |

---

## 6. Rules this work runs under

Beyond the house rules in the 08-19 handoff §4, the ones specific to PSP:

- **Never call `POST /Records` outside a test that scripts `fetch`.** It bills on three of four
  outcomes, and there is no idempotency header — a retry is a second charge.
- **Never call `GET /Token` from anything automatic.** It mints, and the guide does not say whether
  minting invalidates the current token.
- **`GET /DayMonitored45` is the only safe probe.** Neither mints nor bills.
- **Verify against the live service, not the spec.** The OpenAPI's `servers` block is wrong for UAT,
  its schemas declare nothing required, and the guide's version history contradicts its own §8.5 on
  detail 32. Three sources, none authoritative alone.
- **Read the ledger before the projection.** `response_raw` is the evidence; the parse is an index
  over it.
- **Enumerate, don't pattern-match, when a wrong value costs money.** `PSP_JURISDICTIONS` is the
  worked example: the test set leans on GU, VI, NT and ON, and a two-character regex would have
  accepted a typo just as happily.
- **Production needs both switches.** If a change makes `PSP_PRODUCTION_ACKNOWLEDGED` redundant,
  that change is wrong.

---

## 7. Housekeeping

- **`pnpm lint` fails locally and it is not this code.** Every error is inside
  `.claude/worktrees/sad-jennings-93f20d`, another session's git worktree — git-ignored, not
  ESLint-ignored. CI checks out fresh and never sees it. Confirm with
  `pnpm lint 2>&1 | grep '^/Users' | grep -v worktrees` — silence means the tree is clean.
- **Tell PSP support** when moving to production, and **request a fresh token** for it (their ask).
- **Their open questions**: Miki's last name (`git config` reads *Miroslav Jokovic*), and how the
  Implementation Guide was obtained — the copy in `docs/psp-docs/` is dated 2026-08-19, before this
  account setup.
