# Handoff — FuelGuard EFS card control, Phase 10 continued

**Written 2026-08-17, late.** Successor to `docs/38`, which is still correct about the environment,
the standing rules and the method — **read it first**, then this for what changed.

Two vendor facts were settled live this session, one shipped feature came out of them, and **two
corrections to standing knowledge were earned the hard way.** Start with §1 and §2.

---

## 1. ⚠ Two corrections to things this project believed

### 1.1 Setting a Railway variable does NOT reliably restart the service

`docs/38` §2 and `docs/28` §2 both say: *"Deleting a Railway variable does NOT restart the service.
Setting one does."* **The second half is false.** On 2026-08-17 `EFS_CARD_CONTROL_PROBE_ENABLED=true`
was set, a deployment followed it, and the running process still did not have the value — the probe
answered `probe_disabled` after passing auth and step-up, which is only reachable if the flag reads
false in the process. A forced `railway redeploy` fixed it.

**The rule, in both directions:** set or delete, then `railway redeploy --service "@fleetguard/api"
--yes`, then poll `/api/version` until the `deploymentId` CHANGES. Config is not the process.

```bash
railway variable set EFS_CARD_CONTROL_PROBE_ENABLED=true --service "@fleetguard/api"
railway redeploy --service "@fleetguard/api" --yes
# then poll until deploymentId moves — and check commitShort too
```

⚠ Note the CLI's argument order for delete: `railway variable delete --service "@fleetguard/api" KEY`
— key LAST, and `--yes` is not accepted on `variable delete`.

### 1.2 A gate's EXIT CODE is the result; its stdout is commentary

`pnpm lint:filesize` was run as `… | grep -E "GREW|✓ file-size" | head -2`. The failure line reads
`✗ pinned files grew their compressed-line budget` — matching neither pattern — so the filter hid the
failure and showed the reassuring line above it. CI caught it; a cycle was burned proving it.

**The file-size gate has TWO dimensions.** Lines, and a *compressed-line budget* counting statements
over prettier's 100 columns (`COMPRESSION_BUDGETS`). A 102-character line is a violation even when the
file is under its line pin.

**Never grep a gate for the answer you expect.** Run the loop:

```bash
for g in lint typecheck test lint:filesize lint:funcsize lint:tests lint:boundaries \
         lint:ui-adoption lint:tokens-parity lint:comment-claims lint:wsdl lint:codegen \
         lint:cli-streams; do
  pnpm $g >/dev/null 2>&1 && echo "✓ $g" || echo "✗ $g FAILED"
done
```

---

## 2. What the vendor told us — H16 and H17, both proven live on QA

### 2.1 An armed override makes EFS silently ignore a status change (H16)

Two byte-identical `<status>HOLD</status>` writes, same session, same card, same casing: **landed at
`overrideUses: 0`, did NOT land at `1`.** Three readings over 11s, `version` unchanged,
`responseShape: empty`, **no fault in either case** — the ignored write is indistinguishable from the
applied one at the response layer. Only the verifying re-read catches it.

So WEX's portal sentence — *"when a card is in override no changes can be made to the card"* — is true
of the WEB SERVICE. Nothing in the 200-page SOAP guide mentions it.

⚠ **But FIELD-scoped, not card-scoped.** In the same run the echo `clear_override` **landed** and
`deleteOverride` **landed**. The override trio stays writable — it must, or no override could ever be
cleared. And the MILEAGE override is untouched by this: `overrideLastMileage` is unit-keyed and never
touches `setCardv2`. *"Everything that writes"* is the obvious generalisation and it is wrong.

### 2.2 The combined write LANDS — clear-and-lock is one press (H17)

Status + `overrideClearEdits()` in ONE request applied both (`uses: 0, status: HOLD` afterwards). EFS
judges the status against the request's own effect, not the card's arrival state. **`card_lock`'s
`clearException` does what its confirmation promises.**

### 2.3 What shipped from them

| | |
|---|---|
| `packages/shared/src/efs/overrideFreeze.ts` | The rule: which capabilities are blocked, and what each refusal says |
| `apps/api/src/efs/capabilities/overrideFreezeGuard.ts` | Option A — refuse from `snap.doc`, the FRESH read, never the mirror |
| `cardLock.behaviour.ts` | Option B — `clearException` appends the trio to the same write |
| `apps/web/src/features/fuelCards/overrideException.ts` | The drawer's half: checkbox label, help, blocker sentence, confirmation clause |

**Also closed:** `deleteOverride` is entitled on this account and lands — D1's entitlement half, open
since Phase 8.2, confirmed twice.

---

## 3. The two fixes owed, both from real operator pain

### 3.1 The grant's "Sent, but not confirmed" reads as a failure when it is not

Miki granted an exception from the dashboard, saw *"The change was sent to EFS and we could not
confirm what happened. Check the card in the WEX portal before trying again — retrying could apply it
twice"*, and reasonably concluded the grant was broken.

**It had worked.** The next probe run refused to start because that card *already carried 1 use* — the
guard reading the state the operator could not see. What is unconfirmable is the **scope**, never the
count: this account has never once echoed `overrideAllLocations` back (H2/H3 — 234 mirror rows
`false`, none `true`), and Step 3.11 deliberately refuses to claim a scope it cannot observe.

**The fix is the sentence, not the machinery.** For `override_grant` specifically it should say the
exception is *probably armed* and to check before granting another — the current wording implies
nothing happened, which is the opposite of the truth and invites exactly the double-grant it warns
about. See `overrideGrant.behaviour.ts` and the outcome copy it feeds.

⚠ Do NOT "fix" this by calling the grant `succeeded`. Step 3.11 exists because that was tried and the
scope genuinely is unobservable.

### 3.2 The 2–3 minute wait before *Remove exception* appears — UNDIAGNOSED

After a grant, Miki had to wait 2–3 minutes before he could remove it. Partially chased and **not
solved** — do not trust the following as a diagnosis, only as where to start:

- `useCardControl.ts` invalidates on `onSuccess`, and a `sent` outcome is still HTTP 200, so
  invalidation *should* fire.
- `dispatch.ts` calls `updateMirror` in every branch after a successful re-read, so the mirror
  *should* carry `override_uses: 1` immediately.
- `cardControlModel.ts` has `known: !stale` driving the badge's "Override: unknown" text — that is
  DISPLAY freshness and should not gate the *action*.
- `cardOperations.ts`'s clear operation applies on `usesLeft(card) > 0 || scope armed`.

**Same root cause probably explains "nothing changed in the drawer":** the clear-and-lock checkbox
renders only when `card.overrideUses > 0`, so if the page's card data lags, the checkbox lags with it.
The wiring is correct (`FuelCardDetailPage.vue:316`).

---

## 4. ⚠ Phase 10.3 is blocked on a vocabulary path, not on UI work

**Nothing carries the account's limit IDs to the browser.** `cardCapabilitiesContract.ts` has
`editableInfoIds: z.array(z.string())`, read by `allowedInfoIdsFrom(capabilities)`. There is **no
equivalent for products.**

Build the picker first and it gets fed from `EFS_LIMIT_LABELS` — our transcription of the guide's
table, not the account's set. **That is Phase 9.1's defect exactly, one phase later**, and `docs/38`
§4 lists it as the first thing verification caught last time:

> 9.1 was HALF done — no endpoint carried `editableInfoIds` to the browser → *API accepting 24 prompt
> ids while the drawer offered 2, silently*

So 10.3 is two steps: **(1)** carry the vocabulary (`getProducts`, already walked by Phase 7's
inventory) onto the capabilities payload the same way `editableInfoIds` travels; **(2)** then the
picker and amount.

### The three portal-documented rules 10.3 must not get wrong

From WEX's own eManager guides — the Overrides one is checked in at
`docs/efs/eManager-Overrides-2017-11.pdf`, full citations in `docs/37` §8:

1. **The amount is the TOTAL, not the increment.** *"Override limit does not 'add' to the existing
   limit; it is REPLACING the limit as a daily total (i.e. if a card has a 100 gallon limit of diesel
   and the card needs an additional 50 gallons, the override would need to be in place for 150
   gallons)."* A field labelled "additional gallons" grants LESS than the card already allowed, and
   the driver is declined for asking for more.
2. **Diesel needs BOTH `DSL` and `ULSD`.** *"different truck stops use different product codes for
   fuel."* p194's ULSD-only example is not a complete operational recipe — the picker must pair them.
3. **`hours` gets no asserted meaning in the UI.** The override screen calls it *"hours allowed between
   swipes"*, the limits screen calls it *"when to refresh the limit"*, and the SOAP field table matches
   the second. p194 writes `hours: 1, minHours: 0`; keep that default and label it neutrally.

⚠ **Check `docs/37` §8 before opening a WEX ticket.** Three official eManager guides answered two
questions this workstream had written down as *"only WEX can answer"*. They do NOT extract through
`WebFetch` (it reports corrupted binary) — download and run `pdftotext`.

---

## 5. State, and what is already done

10.1's write path is **merged**: `grantOverrideSchema.limits`, `overrideGrantEdits` computing
`removals` from the document (the plan's `removals: []` was wrong and would have been refused on every
card that has limits), the step-up split so a product override demands a password at one use, and
`limitsBefore` in the audit row so a failed vendor restore is recoverable.

10.2 was **already done** in Step 6.2 — verify before re-doing it.

Owed: **10.3** (see §4), **10.4** (two QA cards, in order: the restore check needs a card WITH
card-level limits — on QA that is only ••••7672 — and the sequence-position check needs one with
none), **10.5** promote.

Six PRs merged this session, the last being `7a3a93d`. `docs/plans/silvicom360/` is Miki's and is
deliberately untracked.

---

## 6. The method held, and it is why this session found things

Every finding here came from verifying rather than assuming, and **two wrong answers were caught by
evidence rather than by review**:

- The first F9 run sent `Hold` to an account that stores `ACTIVE`, reproduced H1's
  accepted-and-ignored, and looked exactly like the override freeze. It was caught only because the
  transcript records `statusSent`. **`variant: "standard"` makes an experiment's edit ALGEBRA match
  production, not its VALUES** — pass `matchAccountCasing: true` for any status write standing in for
  a real capability.
- A drill whose negative result has more than one available explanation needs a **CONTROL**. The
  second run proved the identical write landed moments earlier with no override armed, which is what
  turned it into evidence. That is the method H1 used on itself.

And say what you expect BEFORE the command runs. The prediction for F9 was ~60/40 that the freeze was
a portal-UI rule. It was wrong, and the record kept it — a losing prediction that quietly disappears
is worth nothing.
