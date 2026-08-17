# F9 — does a card in override accept any other change? QA probe runbook

**Written 2026-08-17. Authorised by Miki the same day.** Answers `docs/37` §7 **Q6**, the question
WEX's own portal documentation raised and the SOAP guide never mentions.

> ## ✅ RUN, AND ANSWERED — 2026-08-17. The freeze is REAL.
>
> Full result in **docs/22 H16**; transcript `docs/efs/f9-override-freeze-qa.json`. Two byte-identical
> `<status>HOLD</status>` writes on QA ••••7671: **landed at `overrideUses: 0`, did NOT land at `1`.**
> Field-scoped though — `clear_override` and `deleteOverride` both landed on the same armed card.
>
> **The prediction below was wrong** (I leaned ~60/40 toward "portal-UI rule only"), and the FIRST run
> was invalid: it sent `Hold` to an account storing `ACTIVE` and reproduced H1 instead. The control run
> in the sequence is what settled it. **Everything below is kept as written, predictions included** —
> §4.3's discipline only means anything if the record survives being wrong.
>
> The guard it produced shipped in the same day: `card_lock` takes `clearException` (clear and lock in
> one write, never inferred); `card_unlock`, `card_deactivate` and `prompts_set` refuse and name the
> exception. See `packages/shared/src/efs/overrideFreeze.ts`.

> All three eManager quick-reference guides, in the notes under BOTH override flows:
> *"When a card is in override no changes can be made to the card (i.e. status, add cash, etc.),
> therefore, it is recommended that (1) one override/swipe be selected."*

**Why this outranks the rest of Phase 10.** `card_lock` is the 2am action for a stolen card, and this
codebase has deliberately kept it free of every kind of friction — no reason required (decision B1),
no step-up (`CAPABILITIES_WITH_STEP_UP_GATE` omits it on purpose). **No capability checks
`overrideUses` today.** If the vendor's sentence holds for the web service and not merely for the
portal's screens, then a card carrying an override cannot be locked, and the operator is told only
*"EFS accepted the request but the card is unchanged."*

⚠ **And our live override CLEAR is itself a `setCardv2`** on a card that is by definition in override.
`overrideClearBehaviour` is commented *"the proven mechanism, and the one that is live today"*. If the
freeze is real, that path cannot work — which would explain why WEX built `deleteOverride` (guide p27)
as a dedicated operation taking nothing but a card number.

## What is and is not already known — read this before interpreting anything

| | |
|---|---|
| H5 (docs/22) | The `card_lock` proof: `HOLD` → `ACTIVE`, on a card with **no override**. Says nothing about F9 |
| The echo clear's "proven" | Production-wired and offline-verified. **Not** proven live against a card carrying an override; no OEG record exists |
| `deleteOverride` | Implemented (`deleteOverrideOp`), flag-gated, **entitlement never confirmed on this account** — that is D1's open half. So the escape hatch is itself unproven |
| The counter-reading | *"If there is no button to select under 'Override Card' the card is already in override"* is plainly about screens, which is the best available hint the freeze is a portal-UI rule. A hint, not the answer |

## Preconditions

- **QA/staging only.** `EFS_CARD_CONTROL_PROBE_ENABLED=true` for the session, **unset afterwards** —
  and ⚠ standing rule 15: deleting a Railway variable does **not** restart the service. `railway
  redeploy` and confirm the `deploymentId` changed.
- Admin sign-in **fresh** (<5 min); the endpoint demands step-up.
- ⚠ **Have the WEX portal open and signed in before you start.** If the freeze is real, both API clear
  paths may be closed and the portal's *Remove Override* button is the only way back. WEX documents it:
  *"To Remove an override bring up the card and click on the 'Remove Override' button."*
- ⚠ **Pick a disposable card with NO `<limits>`.** Not ••••7672 — that is the only QA card carrying
  card-level limits (DEF 250, RFR 75, ULSD 500) and Step 10.4's restore check needs it intact.
- ⚠ **Last-4 is not an identity in QA** — three cards answer to several of them (docs/22). Identify the
  card by its `<infos>` contents from the first `read_state`, and record that, not just the last four.
- Start the card **Active** with `overrideUses: 0`. Step 1 confirms both.

## Run it with the CLI — one command, and the cleanup cannot be skipped

```bash
node scripts/efs.mjs f9-probe --expect-org qa --out docs/efs/f9-override-freeze-qa.json
```

It prompts for the admin token, then the step-up password, then the card number — all hidden, none of
them in shell history (rule 13). It then runs the whole sequence below in order, prints the narration
to stderr and writes the full transcript of every step as JSON.

**Why the CLI and not nine pasted fetches.** The middle of this sequence ARMS AN OVERRIDE, and the
failure it is testing for is the one that makes the override hard to remove. A hand-run list that
aborts halfway leaves the card armed; the command puts the cleanup in a `finally`, so "the run threw"
cannot mean "the card stays armed". Same reasoning as `suspend-drill`, which exists for the same reason.

What it refuses, before asking for a single credential:

| Refusal | Why |
|---|---|
| no `--expect-org` | It arms a real override. `suspend-drill` already paid for "use a QA token" plus a production token (docs/22 H10) |
| `--expect-org production` | Nothing about F9 needs production, and a production card stuck in override is a truck that cannot fuel |
| `--card <number>` | A PAN in argv is in the process table and the shell history. Rule 13 |
| a card already in override | Clearing it is one of the things under test, so we must set the starting state ourselves |
| a card carrying `<limits>` | On QA that is ••••7672, and Step 10.4's restore check needs it untouched. F9 is about STATUS |

And what its cleanup does, in this order: clear the override (echo, then the dedicated op if that
fails), **then** restore the status. That order is the finding it is chasing — if the freeze is real, a
status write cannot land until the exception is gone, so restoring the status first would fail for the
same reason the test failed and read as a second result. It exits `2` if either half is unrestored.

### The manual fallback

If the CLI cannot reach the API, the same sequence runs from the browser console on a signed-in admin
page, as the Phase 0 runbook does — but then **the cleanup is yours to remember**:

```js
const experiment = (body) =>
  fetch("/api/fuel-cards/experiment", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${window.__accessToken ?? ""}` },
    body: JSON.stringify(body),
  }).then(async (r) => ({ http: r.status, ...(await r.json()) }));
```

## ⚠ Predictions, recorded BEFORE the run

Per the method (§4.3): stating these first is what makes the run evidence rather than a formality.

| Step | What I expect | What would surprise me, and what it would mean |
|---|---|---|
| 2 grant | `landed: true`, `overrideUses` 0 → 1, `overrideAllLocations` read back **false** | A `true` on the scope flag would contradict 234 mirror rows and four fixtures (H2/H3) |
| **4 lock** | **Genuinely uncertain, and that is why this is worth running.** I lean ~60/40 toward `landed: true` — i.e. the freeze is a portal-UI rule — because the guides' own phrasing is about buttons and screens | `landed: false` with `overrideUses: 1` in every reading ⇒ **the freeze is real for the API**, and `card_lock` needs a precondition plus an override-aware message. That is a product change, not a Phase 10 detail |
| 6 echo clear | Follows step 4. If the lock landed, this lands | If the lock landed but the clear did **not**, the restriction is narrower than WEX's sentence and specific to the override fields — the most interesting outcome of all, and the one no document predicts |
| 8 delete_override | Entitlement unknown. This is D1's open half and the run answers it either way | `not_allowed` ⇒ the escape hatch does not exist on this account, and the portal button is the only clear when the freeze bites |

**If step 4 lands, F9 resolves to "portal-UI rule only", Q6 closes, and Phase 10 proceeds to 10.4
unchanged.** That is the cheap outcome and it is why this runs before anything else.

## The sequence — what the command does, step by step

The CLI runs all of this. The calls are written out so the transcript can be read against them, and
so the manual fallback is a copy-paste rather than a reconstruction. Run in order. **Record every full response**, not just `landed` — the readings carry the latency
arithmetic that H5 showed matters (its first verifying re-read MISSED, and the raw duration read as
"9× slower" when it was not).

**1 — state (read-only).**
```js
await experiment({ experiment: "read_state", cardNumber: "<full card number>" })
```
Record `status` verbatim, `version`, `overrideUses`, `documentShape`, and the `<infos>` contents that
identify this card. **Abort if `overrideUses` is not 0** — pick another card rather than clearing this
one, because a clear is one of the things under test.

**2 — arm a 1-use override.**
```js
await experiment({ experiment: "set_override", cardNumber: "<card>", uses: 1, confirm: "WRITE <last4>" })
```
One use, all locations. `uses: 1` because WEX recommends it *for this very reason* and because it is
below the step-up threshold.

**3 — confirm it is armed.**
```js
await experiment({ experiment: "read_state", cardNumber: "<card>" })
```
`overrideUses` must read 1. If it reads 0 the grant did not land and **stop** — there is nothing to
test and step 4 would report a false negative.

**4 — ⚠ THE TEST: lock the card while the override is armed.**
```js
await experiment({ experiment: "set_status", cardNumber: "<card>", status: "Hold", variant: "standard", confirm: "WRITE <last4>" })
```
`variant: "standard"` deliberately: `experimentEdits` uses the same `CardEdit` algebra as production,
so a negative result is about the override and not about the variant.

Each reading now carries `overrideUses` alongside `status` — added for this probe — so a `landed:
false` shows the override was still armed **at that instant** rather than leaving it to be inferred
across three calls.

Read `landed`, and read all three readings' `status` and `overrideUses`. `landed` uses
`efsStatusEquals`, so `HOLD` vs `Hold` is handled and a false is a real false.

**5 — independent confirmation.**
```js
await experiment({ experiment: "read_state", cardNumber: "<card>" })
```

**6 — the echo clear, which is the live production path.**
```js
await experiment({ experiment: "clear_override", cardNumber: "<card>", confirm: "WRITE <last4>" })
```

**7 — confirm.**
```js
await experiment({ experiment: "read_state", cardNumber: "<card>" })
```

**8 — the dedicated op.** Run this **even if step 6 worked** — it answers D1's entitlement question,
open since Phase 8.2, at the cost of one dispatch. If step 6 did **not** work, re-arm with step 2
first so there is an override to delete.
```js
await experiment({ experiment: "delete_override", cardNumber: "<card>", confirm: "WRITE <last4>" })
```

**9 — restore.** Card back to `Active`, `overrideUses` 0.
```js
await experiment({ experiment: "set_status", cardNumber: "<card>", status: "Active", variant: "standard", confirm: "WRITE <last4>" })
await experiment({ experiment: "read_state", cardNumber: "<card>" })
```

## Recovery ladder, in order

1. Step 6 (echo clear) → 2. Step 8 (`deleteOverride`) → 3. **WEX portal → look up the card →
*Remove Override*** → 4. Once the override is gone, step 9 restores the status.

⚠ A QA card is never swiped, so a 1-use override does **not** self-consume here. It stays armed until
something clears it. Do not end the session with an override armed.

## Recording the result

- `docs/22` gets the finding as **H8**, with the redacted request/response XML for step 4 — the
  vendor's own bytes are the evidence, per the pattern H1 set.
- `docs/37` §7 Q6 gets the answer and stops being a question.
- `docs/28` §10's exit gate ticks the F9 row.
- **If the freeze is real:** `card_lock` (and `card_unlock`, `card_deactivate`, `prompts_set`, the
  mileage override) need a precondition that names the override and tells the operator to clear it
  first. That is a new step, and it is a safety fix — not a Phase 10 step, and it should jump the queue.
- **If it is not:** say so explicitly in Q6, including that WEX's own documentation says otherwise. A
  vendor sentence we have disproven is worth more written down than one we quietly stopped believing.
