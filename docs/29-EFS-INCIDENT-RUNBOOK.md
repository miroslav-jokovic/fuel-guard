# EFS Card Control — Incident Runbook

**Step 5.2 of `docs/28-EFS-EXECUTION-PLAN.md`. Must be usable by somebody who did not build this.**

You are here because a fuel card changed when it should not have, or did not change when it should
have, or nobody can say which. Work top to bottom. **Contain before you diagnose** — §2 takes about a
second and costs nothing but a re-enable.

| | |
|---|---|
| **Fastest containment** | `node scripts/efs.mjs promote <capability> --suspend --reason "…"` |
| **How fast** | **481 ms** to full effect on QA, measured 2026-08-15 — the very next call was refused |
| **Does it need a deploy?** | **No.** No cache anywhere in the gate |
| **Blast radius of suspending** | One capability, one org. Reads are untouched |

> ⚠ **Every command below prompts for its token, hidden.** Tokens and card numbers are never flags —
> a flag lands in shell history and in the process table. `FG_TOKEN` is honoured **only** with
> `--token-from-env`.
>
> ⚠ **`--api` defaults to the API host.** The web host runs a copy of this API that WEX's firewall
> refuses, and since Step 5.10 it answers `efs_routes_not_served_here`. If you see that code, you
> pointed the tool at the wrong host.
>
> ⚠ **Reference cards by masked last four (`••••7671`).** PANs never enter this repository, a ticket,
> or a chat message.

---

## §1 Assess — what is the blast radius?

Answer three questions, in this order. **Do not skip to §2 without at least question 1**, because the
answer changes what you suspend.

### 1.1 Which capability, and is it even on?

```bash
node scripts/efs.mjs scan            # prints the org, its settings, and each capability's state
```

A capability that is not `enabled` cannot have done this. If every capability reads `not_promoted` or
`suspended`, **the writes did not come from us** — go to §1.4.

### 1.2 How many cards were touched, and when?

The mutation ledger is the record. Every write the product has ever made has a row, opened *before*
dispatch, so a crash mid-write leaves a visible `pending` row rather than silence.

```sql
-- Blast radius for the last 24h, by outcome. Run against the org you are investigating.
select intent, capability_key, status, count(*), min(created_at), max(created_at)
  from efs_card_mutations
 where org_id = '<org uuid>'
   and created_at > now() - interval '24 hours'
 group by 1,2,3
 order by 5;
```

Read `status` as:

| status | what it means | is the card in a known state? |
|---|---|---|
| `succeeded` | written and confirmed by re-read | yes |
| `drift_detected` | written, and something we did not touch also moved | yes — EFS won, mirror updated |
| `failed` | did not land | yes — unchanged |
| `partial` | a sequence applied some steps and stopped | **no** — see §4 |
| `sent` | **we do not know.** The re-read failed | **no** — see §4 |
| `pending` | opened and never settled: the process died mid-write | **no** — see §4 |

### 1.3 Who did it, and did anyone approve it?

```sql
select id, intent, capability_key, status, reason,
       requested_by, approved_by, step_up, created_at, completed_at
  from efs_card_mutations
 where org_id = '<org uuid>' and created_at > now() - interval '24 hours'
 order by created_at desc;
```

`approved_by` is populated from Step 5.3 onward. **Rows older than that migration have it null and
that is not suspicious** — nothing wrote the column before then. `approved_by = requested_by` is a
recorded self-approval, which is the normal shape today: plan and apply are one request.

Per card, the same history is available without SQL:

```
GET /api/fuel-cards/:id/history
```

### 1.4 If the ledger does not explain it

Then the change did not come from this product. In order of likelihood:

1. **Somebody used the WEX portal directly.** The mirror will show it as drift on the next sweep.
2. **EFS changed it.** Fraud holds are applied vendor-side without asking us.
3. **The other org.** QA and production are two orgs in **one deployment** —
   `07fe4058…` = QA, `86d6b3ea…` = production. Confirm which org the token you are holding belongs
   to before concluding anything. A previous incident was caused precisely by this confusion.

**A mirror row only tells you what EFS said at `detail_synced_at`.** It is not live. The sync
scheduler runs every 24 h (`EFS_CARD_SYNC_HOURS`), so a badge can be most of a day stale — production
`••••7550` showed `Override: 1 use left` for nine hours after EFS retired it. To get the truth now:

```bash
node scripts/efs.mjs sync                 # force a mirror sweep
node scripts/efs.mjs job efs_card_sync    # watch it
```

---

## §2 Contain — stop it, then think

**Suspending a capability is instant, needs no redeploy, and is reversible.** It is cheap enough that
suspending the wrong one costs nothing. Do it first.

```bash
node scripts/efs.mjs promote <capability> --suspend --reason "why, in a sentence"
```

Capabilities: `card_lock`, `card_unlock`, `override_grant`, `override_clear`, `prompts_set`.

**What happens.** The promotion row for that org and capability moves to `suspended`. There is no
cache anywhere in the gate, so **the next card write already sees it** and is refused before any
vendor call. Measured at 481 ms end to end on QA. The refusal is `card_control_not_entitled` at the
gate — no request reaches EFS, so no vendor budget is spent and nothing half-applies.

**What it does NOT do.** Reads are untouched: the mirror, the card list and the history all keep
working, which is what you need in order to investigate.

### 2.1 If suspending one capability is not enough

Escalating, in order. Each is broader and slower than the one above it.

| # | Action | Effect | Speed |
|---|---|---|---|
| 1 | `--suspend` each affected capability | one capability, one org | ~0.5 s each |
| 2 | `efs_card_control_settings.enabled = false` for the org | every write for that org | next request |
| 3 | `EFS_CARD_CONTROL_ENABLED=false` on Railway | every write, every org, whole deploy | **needs a restart** |
| 4 | `EFS_SOAP_ENABLED=false` on Railway | also stops the transaction feed | **needs a restart** |

**Prefer 1 and 2.** 3 and 4 require a Railway variable change and a restart, which is minutes, not
milliseconds — and 4 takes down fuel-transaction ingestion, which is almost never what an incident
about a *write* requires.

Ask Miki before changing anything on Railway. `grep` the variables rather than dumping them.

### 2.2 Record it

Suspension writes an audit row (`card.capability_suspended`) and emits the
`promotion_state_changed` signal at `warning`. Both carry your reason. Write a real sentence: it is
what the next person reads first.

---

## §3 Recover — putting a card back

> **There is no revert button. That is Phase 14.** Until then recovery is manual, and this section is
> the exact procedure.

`efs_card_mutations.before_document` holds the card **exactly as EFS reported it in the same
operation that changed it**. That is what makes a revert replayable, and it is what you read to know
what to restore to.

```sql
select id, intent, before_document, after_document, drift, completed_at
  from efs_card_mutations
 where id = '<mutation uuid>';
```

### 3.1 Restore through the product, if the capability is safe to use

If you have diagnosed the fault and it is *not* in the write path itself — a wrong input, an operator
mistake — the cleanest fix is the inverse capability: `card_unlock` undoes `card_lock`,
`override_clear` undoes `override_grant`. This leaves a ledger row and an audit trail, which the
portal does not.

**Do not do this if the capability is suspended because it is misbehaving.** Re-enabling a broken
capability to fix the damage it caused is how a small incident becomes a large one.

### 3.2 Restore through the WEX portal

The path when the capability cannot be trusted, or when the product refuses.

1. Sign in to the WEX/EFS portal with the account for the affected org. **Miki holds these
   credentials** — this step is his, not an engineer's.
2. Find the card by its last four. Do not paste a full PAN into a ticket on the way.
3. Compare the live card against `before_document` from §3, field by field, for the fields the
   mutation's `edits` names. Change nothing the mutation did not touch: something else moving is
   drift with its own cause, and reverting it by hand destroys the evidence.
4. Apply the correction in the portal.
5. Force a sweep so the mirror agrees with reality, and confirm:
   ```bash
   node scripts/efs.mjs sync
   node scripts/efs.mjs job efs_card_sync
   ```
6. Re-read the card and confirm the value. **A successful response is never evidence of a correct
   write. Only a re-read is.**
7. Note the portal change in the incident record. A portal edit leaves no row in our ledger, so the
   only place it will ever be written down is wherever you write it down.

### 3.3 Re-enabling afterwards

A suspended capability goes back through the promotion gate — it is not a toggle:

```bash
node scripts/efs.mjs promote <capability> --proof <proof uuid> --reason "…"
```

The gate refuses by default and lists **every** reason at once. If the suspension was caused by a
real defect, the honest sequence is: fix, run a fresh proof, cite that proof. Citing the old
pre-incident proof is asserting that nothing changed.

**On production, the person who ran the proof may not be the one who promotes it** (Step 5.3). That
is not a bug in the tool; find a second person.

---

## §4 The state that needs a human: `sent`

**`sent` means the write was dispatched and the re-read did not come back.** We do not know what the
card looks like. It is surfaced to operators as **Unverified**.

This is the most dangerous status in the system and the easiest to underestimate, because *nothing
errored*. The request returned 200. Collapsing it into `failed` would tell somebody a card is
unchanged when it may not be, so the product deliberately refuses to guess — and Step 5.1 reports it
at `error`, above `failed`.

`partial` and a stale `pending` are the same problem wearing different clothes: `partial` means a
sequence applied some steps and stopped, so the card is in a state nobody chose; `pending` means the
process died between opening the row and settling it.

### 4.1 What to do

1. **Do not retry.** The retry button is disabled on a `sent` result on purpose. The write may have
   landed; a second one could double an override — the failure mode of a double-submitted override is
   a driver getting two free tanks.
2. **Go and look.** Re-read the card:
   ```bash
   node scripts/efs.mjs sync
   ```
   then `GET /api/fuel-cards/:id`, or read it in the WEX portal.
3. **Compare against `edits`** on the mutation row. That names exactly which fields the write was
   trying to change, so you know what to look at.
4. **Then it is an ordinary state.** If the change landed, treat the mutation as `succeeded` in your
   notes and say so in the incident record — do not edit the ledger row; it is the honest record of
   what we knew at the time. If it did not land, re-issue it deliberately.
5. **If `sent` rows are accumulating**, the re-read path is broken, not the write path. That is a
   §2 containment situation: suspend, then investigate the vendor's read side.

### 4.2 Clearing a stuck `pending`

A `pending` row blocks every other mutation on that card — `uq_efs_card_mutations_one_pending` is a
database-level guard, and it is the only one that cannot race. If a crash left one behind, the card is
frozen until it settles.

Confirm it is genuinely stale (nothing else is mid-flight, the row is older than the write deadline)
before touching it, and record why in the incident notes.

---

## §5 The signals, and what each one means

From Step 5.1. Every signal writes a `[card-control-signal] <name> {…}` line to the log **and** a
Sentry event at the level below. To grep the Railway log for all of them:

```
[card-control-signal]
```

| Signal | Level | What it means | First move |
|---|---|---|---|
| `echo_unfaithful` | **fatal** | We could not re-parse our own request. **This count must be zero.** | §2 contain, then treat as a serializer bug — it is ours, not the vendor's |
| `card_mutation_settled` `outcome=sent` | error | Unverified — card state unknown | §4 |
| `card_mutation_settled` `outcome=partial` | error | A sequence stopped midway | §4 |
| `efs_breaker_opened` | error | EFS stopped accepting our logins; feed and writes paused | Check credentials, certificate expiry, account lockout. Usually fixed outside this system |
| `card_mutation_settled` `outcome=failed` | warning | Write did not land; card unchanged | Ordinary. Investigate if the rate rises |
| `card_mutation_settled` `outcome=drift_detected` | warning | Something we did not touch also moved | Someone in the portal, or EFS. Check `drift` on the row |
| `promotion_state_changed` | warning | A capability was enabled or suspended | Confirm it was intentional and that `reason` explains it |
| `mirror_sweep_completed` `failed>0` or `cardsWithoutDetail>0` | warning | Cards the product cannot answer questions about | Force a sweep; check the detail budget |
| `mirror_sweep_completed` clean | info | Heartbeat | **Its absence is the alert** — the scheduler runs every 24 h, and a dead scheduler produces silence, not an error |

---

## §6 The drills — and the ones still owed

A runbook nobody has walked is a document, not a procedure. These are the drills that make it real.

### 6.1 Containment walk (QA) — **OWED**

**Status: not yet walked end to end with timings recorded.** The 481 ms figure above is from the
Step 4 suspension drill, which measured suspension propagation only — not the whole containment
procedure from §1 through §2.

The drill, for whoever runs it next. **QA only.** `suspend-drill` requires `--expect-org` and refuses
if the token's real org differs; that guard exists because its absence suspended the wrong company.

```bash
# 0. Confirm which org this token is. Do not skip: this is the guard that was missing.
node scripts/efs.mjs scan

# 1. §1 assess — time it
node scripts/efs.mjs scan

# 2. §2 contain — time from command to refusal
node scripts/efs.mjs suspend-drill --card <efs_card uuid> --proof <proof uuid> --expect-org 07fe4058-...

# 3. Confirm the refusal is card_control_not_entitled at the gate, with no vendor call

# 4. Re-enable through the gate, citing the proof
```

Record: time to assess · time to contain · time to confirm containment · time to re-enable. Append
them to §14 of the execution plan and replace the table at the top of this document.

### 6.2 Signal triggers (QA) — **OWED**

Step 5.1's Verify is "trigger each signal deliberately in QA and confirm it fires". Unit tests assert
each signal's severity and tags; they cannot assert that a real QA event reaches Sentry. How to
trigger each:

| Signal | How to trigger it in QA |
|---|---|
| `card_mutation_settled` `succeeded` | Any successful `card_lock` on a QA card |
| `card_mutation_settled` `failed` | Lock a card with a stale `expectedVersion` → refused by optimistic concurrency |
| `card_mutation_settled` `sent` | Hardest, and the most valuable. Needs the re-read to fail while the write succeeds |
| `promotion_state_changed` | Falls out of 6.1 for free — the drill suspends and re-enables |
| `mirror_sweep_completed` | `node scripts/efs.mjs sync` |
| `efs_breaker_opened` | Three consecutive bad-credential logins against QA. **Opens the breaker for 30 minutes** — do this last, or not at all if QA is needed |
| `echo_unfaithful` | Do **not** trigger against a live account. It is exercised offline by `efs/harness/local.ts`, which is where a serializer bug is supposed to be caught |

Confirm each arrives in Sentry at the level in §5, and that the `[card-control-signal]` line is in
the Railway log.

### 6.3 Not built

The **weekly digest of unknown vendor elements** from Step 5.1 is not built. There is no
"elements the product understands" set in the codebase to subtract from — only `CARD_COLLECTIONS` and
`VOLATILE_FIELDS`, neither of which is that — so "unknown" would have to be invented, and a digest
full of false unknowns trains people to ignore it. The element inventory is a prerequisite feature.
Recorded rather than guessed.

---

## §7 Things that have actually gone wrong here

Kept because each one cost real time, and each is easy to repeat.

- **The wrong org was suspended.** A drill pointed at production, the one org where card control had
  never been promoted, and then could not be restored because production has no proof to cite. The
  safety in that drill was designed around the *card* — a stale `expectedVersion` — and nothing
  checked the *org*. `--expect-org` is now mandatory. **Ask what else an action selects, not only
  what it does.**
- **A promotion wrote no audit row.** `audit_logs.entity_id` is a `uuid`, the route passed the
  capability key `"card_lock"`, the insert failed, the retry failed, and the response said `ok: true`.
  Fixed in Step 5.11, which also found four more call sites doing it.
- **A green deploy check on a half-deployed system.** `deploy-verify` polled one of two hosts and
  reported success while the other was two commits behind. Fixed in Step 5.10.
- **QA testing spent production's vendor allowance.** The rate limiter was keyed on IP, not on the
  org whose EFS account the budget protects. Fixed in Step 5.6.
- **A matching number is not confirmation.** A pre-build simulation predicted the *unit* tier would
  resolve ~100 of 143 unlinked cards. It resolved **0**; the *PAN* tier resolved 103. The headline
  would have matched either way, and only per-row evidence caught it.
- **Before assuming a surprising result means a broken system, check whether the instrument is what
  is broken.** Every live drill in Phase 4 found a defect, and every one was in the harness.
