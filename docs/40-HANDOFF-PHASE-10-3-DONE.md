# Handoff — FuelGuard EFS card control, after Phase 10.3

**Written 2026-08-18.** Successor to `docs/39`, which succeeds `docs/38`.

**Read `docs/38` first** — the environment, Miki's standing rules and the method are all still
correct there and are not repeated. Then `docs/39` for H16/H17 and the override freeze. Then this.

Eleven PRs merged (#90–#100). **Phase 10.3 is code-complete.** 10.4 is **blocked on a fact, not on
work** — start at §1.

---

## 1. ⚠ QA CANNOT PROVE STEP 10.4. Not on any card.

`pnpm efs:scan` now sweeps the read-only fields capabilities branch on. Run 2026-08-18 across every
mirrored document:

| | QA (35 cards) | production (199 cards) |
|---|---|---|
| `infoSource` | BOTH×35 | BOTH×199 |
| **`limitSource`** | **POLICY×35** | **BOTH×180, POLICY×19** |
| `locationSource` | POLICY×35 | POLICY×199 |
| `timeSource` | POLICY×35 | BOTH×188, POLICY×11 |

**Every QA card reads `limitSource: POLICY`**, so no QA card's own limits govern its pump. Step 10.4's
restore check — grant a product override, clear it, see whether the card's limits came back — cannot
be run there on ANY card. It is not a question of picking the right one.

⚠ **That includes `bf47678d-3edb-4a45-bb34-df30dd1bf98d`**, the roster's "card with limits". It really
does carry DEF 250 · RFR 75 · ULSD 500 as card-level records — and on a POLICY-source card those are
stored and never consulted. **A card can hold limits that do nothing.** Do not spend the drill on it.

**Production is where the feature lives: 180 of 199 (90%) are `BOTH`.** 19 must be refused. That is
the number that makes the guard proportionate rather than paranoid or pointless.

### 1.1 So 10.4 needs a scope decision from Miki, and there are three options

1. **Production**, against one of the 180 BOTH cards. Real card, real risk — needs one out of service
   or a driver not fuelling. The drill's self-repair becomes load-bearing rather than a nicety.
2. **WEX.** ⚠ Only after §4 — the documents were searched and this one genuinely is not in them.
3. **Have QA reconfigured** so at least one card is CARD or BOTH-sourced. Cleanest long-term; also
   unblocks whatever in Phases 11–13 needs card-level limits.

Claude's recommendation on 2026-08-18 was **2 then 3, keeping production out of it**. ~~Miki has not
ruled.~~

### 1.2 ✅ RULED, later on 2026-08-18: option 1 — production, one of the BOTH cards

Miki: *"lets do 10.4 on production, one of the BOTH cards."* The drill's production refusal is
lifted (it was justified by "QA answers it", which §1's sweep disproved); production now REQUIRES
`--card-id`, never a typed number.

**The candidates, from the mirror (production org `86d6b3ea…`, 180 BOTH cards, of which exactly SIX
carry card-level limit records):**

| efs_cards.id | card | status | last used | card-level limits |
|---|---|---|---|---|
| `c811dfe6-c707-46a1-b7b4-2185a0dbb863` | ••••6536 | **HOLD** | 2026-08-10 | ADD $40 |
| `7b0d691c-2878-441e-8a88-59185310a6b8` | ••••6692 | **HOLD** | 2026-08-15 | ADD $40 |
| `46b2de42-b72c-4b0a-bb2f-0b69a6eb1ffc` | ••••6635 | ACTIVE | 2026-08-14 | ADD $40 |
| `af69cbb3-6a4d-484d-a4ca-b8eb7c081fe5` | ••••6817 | ACTIVE | 2026-08-15 | ADD $40 |
| `b774c382-6e30-46d4-88d7-db68e970816f` | ••••7559 | ACTIVE | 2026-08-15 | DSL 50 gal |
| `7b1b9991-ada6-4c0d-9f15-a7f1cfade1b4` | ••••6544 | ACTIVE | 2026-08-16 | ADD $40 |

**The chosen card is ••••6536** — on HOLD (so nothing can fuel during the run's armed window, which
closes the production failure mode §1.1 named), longest-idle, one small card-level record for the
restore comparison. The drill re-reads live before writing, so a stale mirror row can only make it
refuse, never mislead it.

---

## 2. ⚠ Two corrections to things this project believed

### 2.1 The limit vocabulary is `getProductGroups`, NOT `getProducts`

`docs/38` §7.1 and `docs/39` §4 both say `getProducts`. **Both are wrong**, and it would have shipped
a picker that could not offer `DSL`.

Confirmed twice, independently:

- **The guide**, on `getProductGroups`: *"groupId — string (4) — The product group ID. **See Limit IDs
  for valid values.**"* `getProducts.code` is *"The product code ID"* with no such cross-reference.
- **WEX's own portal**, captured 2026-08-18: the `Limit ID` picker lists `ACCE - ACCESSORIAL`,
  `ADD - ADDITIVES`, `AMDS - AVIATION MERCHANDISE`… All ten visible rows match this account's
  `getProductGroups` descriptions exactly and in order, and four of them (`AMDS`, `APRO`, `ATOM`,
  `BEVR`) have **no `getProducts` record at all**.

Ten ids in the guide's own Limit IDs table — `DSL`, `GAS`, `JET`, `DSLM`, `DEFC`, `GASM`, `GASP`,
`RFRM`, `AMDS`, `EVCH` — exist only as groups. `resolveLimitVocabulary` owns this now.

### 2.2 `railway redeploy` FAILS after a config-only deploy is skipped

`docs/39` §1.1 established: set or delete, then redeploy, then poll until `deploymentId` changes.
**Incomplete.** On 2026-08-18 deleting `EFS_CARD_CONTROL_PROBE_ENABLED` created a deployment that
Railway marked **SKIPPED** — and `railway redeploy` then refuses, because the *latest* deployment is
the skipped one:

> *"The latest deployment for service @fleetguard/api cannot be redeployed."*

Meanwhile the process kept running with the flag **still live**. The working command is:

```bash
railway variable delete --service "@fleetguard/api" EFS_CARD_CONTROL_PROBE_ENABLED   # key LAST, no --yes
railway redeploy --service "@fleetguard/api" --from-source --yes
# then poll /api/version until deploymentId CHANGES
```

`--from-source` builds the configured source afresh instead of re-running the existing deployment.
**Config is not the process, and a skipped deployment is not a restart.**

⚠ The flag is **unset and the process restarted** as of 2026-08-18 16:13 (`cd2202b2`, commit
`9045573`). Verify before assuming.

---

## 3. What shipped — Phase 10.3 is code-complete

| | |
|---|---|
| `packages/shared/src/efsLimitCatalog.ts` | `resolveLimitVocabulary` — the account's limit ids, labels and units, from `getProductGroups` |
| migration **0202** | `efs_card_control_settings.product_groups` (jsonb) + `_at`. Sibling of 0200 |
| `cardCapabilitiesContract.ts` | `limitOptions` — 9.1's lesson applied BEFORE the defect this time |
| `apps/web/.../overrideLimits.ts` | The three portal rules, the blockers and every sentence the drawer shows |
| `apps/web/.../CardOperationInputs.vue` | The picker, the two location radios, the manual location id, the Optional fieldset |
| `overrideGrant.behaviour.ts` | ⚠ the `limitSource` precondition — see §3.1 |
| `scripts/efs.mjs limit-restore` | The 10.4 instrument. Cannot answer on QA (§1) |

### 3.1 ⚠ The `limitSource` guard is Step 9.4's, one phase later

On a `POLICY`-source card, card-level limits are not what the pump consults, so a `setCardv2`
carrying them is accepted and ignored — and **the echo verifier cannot catch it**, because the card
still STORES the records and the re-read finds them. `override_grant` refuses when `limits.length > 0`
and `limitSource` is POLICY. Only then: a scope-only exception touches no limits and stays available
on every card.

Proven offline against `getCardV2.empty.xml`, the one captured document carrying `limitSource:
POLICY`, and verified by breaking it. **The live half stays open, exactly as 9.4's does.**

### 3.2 The three portal rules, all tested

1. **The amount is the TOTAL, not the increment.** No code can tell those apart — only a label. The
   test asserts the COPY: says REPLACES, never "additional", carries the 100/50/**150** example.
2. **Diesel is two codes**, ~~enforced as a blocker~~ — ⚠ **CORRECTED 2026-08-18, later the same
   day**: the blocker demanded two products where the portal demands ONE. The Overrides guide's own
   flow is *"Select product to override and then 'Next'"* then *"Select 'Save and Add Another' **if**
   multiple products are being overridden"* — one required, the rest optional, and the DSL+ULSD
   pairing is a NOTES-section advisory, not a rule the portal enforces. Miki's ruling matches the
   vendor's flow. It is now `dieselPartnerAdvice` — a caution beside the picker with a one-click
   "add the partner at the same amount" button, never a refusal. Still gated on the account offering
   the partner. ⚠ **And the amounts do not add up** — WEX: *"The system will not combine the gallon
   limit on DLS and ULSD as it recognizes this as one product."* DSL 150 + ULSD 150 is **150
   gallons**.
3. **`hours` gets no asserted meaning.** The portal's two screens disagree; the value `1` is now
   sourced from the Overrides guide rather than copied from p194's example.

### 3.3 `Allow Hand Enter` — shipped, and the wording IS the feature

`handEnter` is `string (7) ALLOW/DISALLOW/POLICY` on getCard/setCard with **no override scope
anywhere**. The portal's placement implies "for these N uses"; there is no such thing. Every sentence
says it does not expire. **True writes ALLOW; false writes NOTHING** — an unticked box is "not asked
about", never DISALLOW. There is deliberately no way to turn it off here; that is Step 12.1's.

---

## 4. ⚠ SEARCH THE DOCUMENTS BEFORE SAYING "ONLY WEX CAN ANSWER"

Miki, 2026-08-18: *"we dont need to ask WEX nothing, all things we need to know are in documents we
have and WSDL we have, maybe you need to find it there."* He was right, and `docs/37` §8 was already
the precedent. Reading the Overrides guide end to end answered four things — see `docs/37` §10 — and
one of them (§3.2's diesel arithmetic) meant our confirmation was actively misleading.

**The restore question is the exception, and only after looking.** Searched the 200-page SOAP guide
and the Overrides guide for restore / revert / reinstate / original limit: **nothing**. p194 says the
write removes the card's limits and adds the override's back and never says what becomes of the
originals. That is now a conclusion from reading, not an assumption.

---

## 5. Open, in rough priority order

| # | What | Where |
|---|---|---|
| **10.4** | Blocked — QA cannot answer it. Needs Miki's ruling (§1.1) | this doc |
| **10.5** | Promote. After 10.4 | `docs/28` |
| ✅ | ~~The portal REFUSES a second override; we offer one~~ **RESOLVED 2026-08-18 — Miki ruled: no grant on a card already in override.** The API precondition and the drawer blocker both refuse via `overrideGrantBlockedMessage`; refusal is uniform (scope-only included, because a landing re-grant REPLACES the count rather than adding, and a grant's non-trio fields risk H16's silent swallow). Mutation `efs-override-grant-on-armed-card` pins it | `overrideFreeze.ts`, `docs/37` §10.4 |
| ⚠ | **`limitSource` live half unproven**, exactly like 9.4's. Production has 19 POLICY cards to prove it on | §3.1 |
| — | `docs/39` §3.2 — the 2–3 minute wait. **Narrowed again**: Miki pressed the *deployment update banner*, which reloads the whole SPA, NOT the card's Refresh. So no live EFS re-read happened and the recovery came from a full reload — which points harder at invalidation not delivering, rather than anything server-side | `docs/39` §3.2 |
| — | `locationSource` is POLICY on all 234 cards. Nothing branches on it today; recorded because the last unlooked-at field cost a phase | §1 |
| — | `card_unlock` still unproven since Phase 8.2 · 9.6's two live add-prompt checks · 9.4's live half | `docs/28` |

---

## 6. Method — what went wrong THIS session, since that is the useful part

Every one of these read as success at the time.

- **A gate that passed its own defect.** The new token linter was written to catch `border-line`, and
  its first version waved it through while catching a different class. `pnpm lint:tokens` printed
  "clean". Its second version flagged `fill-ups` out of English prose — 103 findings. **Verify a new
  gate in BOTH directions**: clean on the tree, and red when you reintroduce the bug.
- **`die()` skips `finally`.** `process.exit()` does not run `finally` blocks, so the 10.4 drill's
  transcript was never written — on the one run that had something to record.
- **A refusal placed after the write.** The drill armed a card, then told it it was the wrong card.
  Any check that decides whether to proceed must run BEFORE the first write, from the baseline.
- **Last four digits do not identify a QA card.** 35 cards share 20 last-4 values; six groups hold
  three cards each — `docs/28` Step 0.13 says so, and it was repeated in a tool that writes to cards.
  **Name cards by `efs_cards.id`.** `limit-restore --card-id <uuid>` and the experiment endpoint now
  take one, resolved org-scoped server-side; no PAN reaches a shell history.
- **A test asserting the wrong property.** "The request must not contain `DISALLOW`" failed because
  the fixture card already carries it and the echo faithfully echoes it back. *Absent from the
  request* and *we did not change it* are different claims.
- **A mutation went stale** when `allowHandEnter` became a fifth argument. The harness fails a
  non-matching pattern rather than skipping it, which is the only reason it was noticed. **33/33.**
- **Overlapping test runs starve the machine.** Individual tests reported 16-minute durations and
  "failures" that were pure CPU contention. A red result at 1,000,000 ms is not an assertion failure.

### 6.1 The one that generalises

`scanConfig` derived its fields from `emittableValues` — what a capability WRITES — and was
structurally blind to fields it READS and branches on. `limitSource` had been observed on **one card,
by accident**, while a guard already depended on it. Step 7.3's *"every card reads `infoSource:
BOTH`"* is true (234/234) and had been carried as settling the source question generally; it settles
one field. **When a guard reads a field, sweep that field across the fleet.**

---

## 7. Gates and commands

`docs/38` §6 still lists them. Additions:

```bash
pnpm efs:scan          # now prints "read-only fields capabilities depend on" per org
pnpm efs:limit-restore --expect-org qa --card-id <uuid> --out <path>   # Step 10.4; refuses on QA
```

⚠ `pnpm lint:filesize` has TWO dimensions — lines, and a compressed-line budget over 100 columns —
plus a THIRD that bit this session: **a waived file that GROWS past its waiver fails.** `experiments.ts`
was waived at 551 and hit 616; the shapes moved to `experimentShapes.ts`. *"A waiver is permission to
be big, not permission to keep growing."*

⚠ `packages/shared/dist` is untracked, not gitignored, and NOT produced by `pnpm build` (which is
`tsc --noEmit`). Only `build:rn` emits it, and the driver app resolves it at runtime. Deleting it
turns the driver suite red; a stale one makes typecheck and runtime disagree — that surfaced as a
confusing `TS2719 "two different types with this name"`. Worth a `.gitignore` entry and a note.
