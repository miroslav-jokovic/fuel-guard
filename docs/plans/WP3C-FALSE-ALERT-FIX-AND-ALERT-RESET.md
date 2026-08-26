# WP3c — masked card numbers, false alerts, and the alert reset

> **⚠ DORMANT (2026-08-26 truth pass):** EFS/anomaly-era spec, superseded in practice by the fuel-spend plans (2026-08).

**Status:** code changes are in the working tree, uncommitted.
**Scope:** why the control-number layer wasn't working, what changed, and the exact sequence to wipe
every existing alert and rebuild from scratch.

---

## 1. What was actually wrong

The control-number layer was built correctly at the top level — `sameCardFill` did require matching
control ids for two masked refs. But three things underneath it defeated that check, and any one of
them alone is enough to produce the false alerts.

### 1.1 A masked card was being read as a full card number

`cardIdentityKey` and `sameCardFill` both classified a ref as a definitive full PAN using
`digits(ref).length >= 8`, where `digits()` strips every non-digit character.

EFS does not always mask to a bare last-4. When the ref arrives as `708305XXXXXX1234`, `digits()`
returns `7083051234` — **ten digits**. So the ref was classified as a full PAN, and:

- `cardIdentityKey` returned `"7083051234"` for it — a key **shared by every card in the fleet with
  that BIN prefix and that last-4**, with the control number never consulted;
- `sameCardFill` hit its `>= 8 digits → return true` short-circuit and declared two such rows the same
  card **even when their control numbers explicitly disagreed**.

That is the primary defect. The control number was in the database and being read — the code just
never reached the branch that uses it.

### 1.2 The full-PAN short-circuit was asymmetric

```ts
// old
if (digits(a.cardRef).length >= 8 || digits(b.cardRef).length >= 8) return true;
```

`||`, not `&&`. So a genuine 19-digit PAN compared against a bare `7521` returned "same card" on a
suffix match — a suffix shared by every card ending in 7521. Since your history contains full numbers
(pre-mask) and your recent rows contain last-4s, **every card crossed that boundary**. This is the
mechanism by which one fill collected other drivers' trucks and fired `card_multi_vehicle`.

The existing test suite encoded this as correct behaviour, which is why it never caught it:

```ts
it("full PAN matches its masked last-4 (cross-report)", () => {
  expect(sameCardFill({ cardRef: "7083050030281917521", controlId: null },
                      { cardRef: "7521", controlId: "WCHRISTO" })).toBe(true);   // ← the bug
});
```

### 1.3 The candidate query fanned out on the last-4, and the page limit truncated the real card

`resolveCardContext` fetched candidates with `.eq("card_ref", ref)` — on a masked ref that returns
**every fill in the org ending in those 4 digits**. `sameCardFill` filtered them afterwards, but the
`.limit(400)` is applied by Postgres (`fueled_at desc`) *before* that filter. On a busy shared last-4
the card's own fills were pushed off the page entirely, silently corrupting both the vehicle count and
the learned as-of assignment.

### 1.4 Why the auto-clear never rescued you

`reconcileCardMultiForOrg` is the pass that dismisses "one card, multiple trucks" cases that Samsara
explains as one driver changing trucks. Two problems:

- it used the same fan-out query, so a conflated foreign fill on a truck Samsara couldn't resolve set
  `allResolved = false` and **blocked** the clear — conflation made the false alert permanent; and
- it was only ever called from `scoreImportWithCascade`. A full **Rebuild never ran it at all**, so
  every case a rebuild raised stayed open with nothing able to clear it.

### 1.5 The UI corroborated the false alert

The sibling-fills table under a `card_multi_vehicle` alert queried `.eq("card_ref", ref)` with no
control-number filter. It therefore listed *other drivers'* fills as evidence for the alert, and
omitted this card's own fills stored in the other format. The alert looked well-evidenced because the
evidence panel had the same bug as the detector.

### 1.6 Same root cause on the decline/rejection side

- `lookupCardAssignment` fell back to "find a card with this last-4; if exactly one is known, use its
  truck". That guard is an illusion once cards are masked — a second physical card with the same
  last-4 that simply isn't in `fuel_cards` yet is invisible to the check. It returned another driver's
  truck, which decline scoring raised as a **weight-75** `card_assigned_mismatch`.
- `sameActor` used `cardRefsMatch` (last-4 tolerant), so `approved_elsewhere` fired on a stranger's
  approval — and, in the other direction, a stranger's fill wrongly *exonerated* a real decline.
- the repeated-declines count was an exact `.eq("card_ref", …)` on a masked ref, pooling every driver
  sharing that last-4: three drivers with one decline each looked like one card tested three times.

---

## 2. What changed

| File | Change |
|---|---|
| `packages/shared/src/cardAssignment.ts` | New `isMaskedCardRef` / `cardDigits` / `isFullCardNumber`. A masked ref is **never** a full card number, however many digits survive the mask. `cardIdentityKey` keys masked cards on `last4\|control` so every masked shape of one card collapses to one identity. `sameCardFill` rewritten: both-unmasked → digits decide; otherwise last-4 must match **and** both control numbers must be present and equal. New `cardRefsDefinitelyMatch` for paths with no control number at all. |
| `packages/shared/src/anomalyRules/{types,rulesBehavioral}.ts` | New `cardIdentifiable` flag on `RuleContext`; `card_multi_vehicle` hard-gated on it and **fails closed** when unset. A card we cannot name is a card we never accuse. |
| `apps/api/src/services/scoring/cardContext.ts` | Candidate scan is now identity-scoped: `control_id` always, `card_ref` **only** for an unmasked full number. Kills both the last-4 fan-out and the `limit(400)` truncation. Returns `cardIdentifiable`. |
| `apps/api/src/services/scoring/cardMultiReconcile.ts` | Same scan fix, so the auto-clear sees exactly what the scorer saw. |
| `apps/api/src/services/scoring/backfill.ts` | `reconcileCardMultiForOrg` now runs after **every** backfill path (rebuild, live recon, and on graceful cancel) — not just after an import. |
| `apps/api/src/services/cardAssignments.ts` | The ambiguous last-4 fallback now requires both sides to be provable full card numbers. |
| `apps/api/src/services/declinedScoring.ts` | `sameActor` uses `cardRefsDefinitelyMatch`; repeated-declines counting requires an unmasked full number. |
| `packages/shared/src/detectionCoverage.ts` | Uses `cardIsIdentifiable` instead of an inline copy of the identity rule that had the same `>= 8` flaw — card-blind fills were being under-reported. |
| `packages/shared/src/attributionHealth.ts` | Buckets by identity key; unidentifiable cards are labelled as such rather than implying a card-level cluster. |
| `packages/shared/src/efsImport/parse.ts` | Merge-collision guard: two rows sharing a last-4 + invoice + date but carrying **different** control numbers are no longer merged into one event with summed gallons. |
| `apps/web/src/features/anomalies/*` | Sibling-fills table applies the identical `sameCardFill` test, so the UI and the engine can never disagree. |
| `apps/api/src/lib/soapClient.ts`, `env.ts`, `routes/integrations.ts` | Optional mTLS / client certificate — see §5. |
| `supabase/migrations/0104_card_identity_reset.sql` | Drops learned `fuel_cards` rows so they relearn under the corrected identity. Manual rows untouched. |

**Verified:** `packages/shared` — 949 tests pass (14 new). `apps/api` — scoring, declined and SOAP
suites pass. `tsc --noEmit` clean for `packages/shared` and `apps/api`. (`apps/web` has two
pre-existing `DataTableColumn` errors in files this change doesn't touch.)

---

## 3. Deploy + wipe + rebuild — run in this order

Substitute your org id. From the last handoff it is `86d6b3ea-4361-4f71-877f-e8373615769b`.

```sql
\set org '86d6b3ea-4361-4f71-877f-e8373615769b'
```

### Step 0 — before anything, measure what you have

Run these and keep the numbers. They are how you prove the fix worked.

```sql
-- Open alerts by rule / signal
select rule_id, severity, count(*)
  from anomalies
 where org_id = '86d6b3ea-4361-4f71-877f-e8373615769b' and status = 'open'
 group by 1,2 order by 3 desc;

-- Open cases whose evidence contains a card signal — the population under suspicion
select count(*)
  from anomalies
 where org_id = '86d6b3ea-4361-4f71-877f-e8373615769b'
   and status = 'open'
   and evidence -> 'signals' @> '[{"ruleId":"card_multi_vehicle"}]';

-- How much of your data is actually card-blind right now (masked, no control number)
select count(*) filter (where card_ref is not null)                       as card_fills,
       count(*) filter (where card_ref is not null and control_id is null) as no_control_number,
       count(*) filter (where card_ref ~ '[Xx*•]')                         as masked_refs
  from fuel_transactions
 where org_id = '86d6b3ea-4361-4f71-877f-e8373615769b'
   and fueled_at > now() - interval '180 days';
```

> If `no_control_number` is a large share of `card_fills`, expect the fixed engine to raise **far
> fewer** card alerts — those fills are now correctly treated as unidentifiable rather than guessed
> at. That is the intended trade: no false accusations on cards we cannot name. The gap shows up
> honestly in Detection Coverage as card-blind fills, and closes as EFS control numbers land on more
> rows (the SOAP feed carries them as info code `CNTN`).

### Step 1 — stop anything that would re-score mid-wipe

`REBUILD_ON_BOOT` re-scores the last 180 days **45 seconds after every deploy**, bypassing the job
ledger. The nightly reconcile does the same at ~03:00 org-local.

```bash
# Railway (API + worker services)
REBUILD_ON_BOOT=false
NIGHTLY_RECONCILE_ENABLED=false
```

Deploy the code fix with those two set. Confirm no job is mid-flight:

```bash
curl -s "$API/api/jobs/latest?kind=rebuild"  -H "Authorization: Bearer $JWT"
curl -s "$API/api/jobs/latest?kind=backfill" -H "Authorization: Bearer $JWT"
```

### Step 2 — apply the migration

Paste `supabase/migrations/0104_card_identity_reset.sql` into the Supabase SQL Editor (or
`supabase db push`). Then run the review query in its footer — it lists any **manual** card
assignments whose ref no longer parses under the corrected identity rule. Re-enter those in
Settings → Fuel cards.

### Step 3 — delete every alert

Safe: nothing has a cascading FK onto `anomalies`. The only reference is
`ai_verifications.anomaly_id`, which is `ON DELETE SET NULL`. There is no delete trigger, and no
DELETE route in the API — this must be done in SQL.

```sql
begin;

-- 3a. Optional but recommended: keep a copy so you can compare before/after and audit what was
--     dismissed. Drop the table once you're satisfied.
create table if not exists anomalies_archive_20260803 as
  select * from anomalies where org_id = '86d6b3ea-4361-4f71-877f-e8373615769b';

-- 3b. Delete every alert for the org, whatever its status.
delete from anomalies where org_id = '86d6b3ea-4361-4f71-877f-e8373615769b';

-- 3c. Clear the denormalised per-fill outcome so the fuel log doesn't show stale flags while the
--     rebuild runs. The rebuild rewrites all of these anyway.
update fuel_transactions
   set has_anomaly = false, max_severity = null,
       case_level = null, case_score = null, case_signals = null, case_gates = null
 where org_id = '86d6b3ea-4361-4f71-877f-e8373615769b';

-- 3d. Clear decline suspicion so those rescore clean too.
update declined_transactions
   set suspicion_level = null, suspicion_reasons = '[]'::jsonb, reason_category = null, scored_at = null
 where org_id = '86d6b3ea-4361-4f71-877f-e8373615769b';

commit;
```

**Deliberately NOT touched:**

- `fuel_transactions.audit_verdict / audit_note / audit_by / audit_at` — your recall-audit ground
  truth. Wiping it would destroy the only measurement of missed fraud you have.
- `samsara_recon_at` and the other `samsara_*` columns — these are the cached telematics facts. Keep
  them and Step 4 is a fast offline rebuild; null them and you force a full live Samsara re-fetch.
- `anomaly_thresholds` — your per-org rule configuration.
- `ai_verifications` — the cache. Its `anomaly_id` goes NULL, which is expected. Delete rows here too
  only if you want the AI verifications re-run from scratch (it costs tokens).

### Step 4 — rebuild

```bash
# Full history, rules only, reusing stored telematics. This is the one you want.
curl -X POST "$API/api/transactions/rebuild" \
  -H "Authorization: Bearer $JWT" -H 'content-type: application/json' -d '{}'
# → 202 { ok, queued: true, jobId }

# Watch it
curl -s "$API/api/jobs/latest?kind=rebuild" -H "Authorization: Bearer $JWT"
```

Role required: `admin` or `fleet_manager`. Add `{"sinceDays": 180}` to limit the window.

The rebuild now also runs the card-multi auto-clear at the end (it previously did not), so
one-driver-moved-trucks cases are dismissed as part of the same pass.

Then the declines, which are a separate pipeline:

```bash
curl -X POST "$API/api/transactions/rescore-declined" \
  -H "Authorization: Bearer $JWT" -H 'content-type: application/json' -d '{}'
```

If you also want telematics re-derived (slow, live Samsara calls — only if you suspect the stored
recon values are wrong), run this **before** the rebuild:

```bash
curl -X POST "$API/api/transactions/backfill" \
  -H "Authorization: Bearer $JWT" -H 'content-type: application/json' -d '{"full":true}'
```

### Step 5 — verify, then re-enable the schedulers

```sql
-- Same breakdown as Step 0. Card alerts should be dramatically down; physics-based rules
-- (tank_space_exceeded, exceeds_tank_capacity, location_mismatch) should be roughly unchanged —
-- if those moved a lot, something other than card identity changed and is worth investigating.
select rule_id, severity, count(*)
  from anomalies
 where org_id = '86d6b3ea-4361-4f71-877f-e8373615769b' and status = 'open'
 group by 1,2 order by 3 desc;

-- No open card case may exist on a fill that can't identify its card. This must return ZERO.
-- If it returns rows, the deployed API is running pre-fix code — check the deploy.
select a.id, a.fueled_at, t.card_ref, t.control_id
  from anomalies a
  join fuel_transactions t on t.id = a.transaction_id
 where a.org_id = '86d6b3ea-4361-4f71-877f-e8373615769b'
   and a.status = 'open'
   and a.evidence -> 'signals' @> '[{"ruleId":"card_multi_vehicle"}]'
   and t.control_id is null
   and (t.card_ref is null or t.card_ref ~ '[Xx*•]' or length(regexp_replace(t.card_ref,'\D','','g')) < 8);

-- Every surviving card case, with its sibling fills, for eyeball review.
select a.id, a.severity, a.message, t.card_ref, t.control_id, t.fueled_at, v.unit_number
  from anomalies a
  join fuel_transactions t on t.id = a.transaction_id
  left join vehicles v on v.id = t.vehicle_id
 where a.org_id = '86d6b3ea-4361-4f71-877f-e8373615769b'
   and a.status = 'open'
   and a.evidence -> 'signals' @> '[{"ruleId":"card_multi_vehicle"}]'
 order by a.fueled_at desc;
```

Spot-check a handful of the survivors in the UI. The sibling-fills table now shows only fills the
engine actually counted, so what you see is what fired.

Then put the schedulers back:

```bash
REBUILD_ON_BOOT=true
NIGHTLY_RECONCILE_ENABLED=true
```

---

## 4. Residual risk you should know about

**The one remaining false-alert source is duplicate transactions, and it arrives the day you enable
the SOAP feed.** `external_ref` — the row-level dedupe key — starts with the card number as printed.
File reports print a masked card; the SOAP feed returns the full number. Same transaction, two
different refs, no upsert conflict, two `fuel_transactions` rows. Duplicates feed
`rapid_repeat_fueling`, `cumulative_overfuel` and the card vehicle count.

Fix is prepared but **not applied**: `supabase/migrations/0105_external_ref_canonical_card.sql` plus
`docs/plans/EFS-REF-CANONICAL-CARD.patch`. Apply both together, after running the migration's
pre-flight collision query, and **before** switching the SOAP feed on. See the migration header.

---

## 5. EFS SOAP — client certificate / mTLS

Yes, worth wiring now. It ships **inert**: with none of the variables below set, `efsTlsOptions()`
returns null, every request goes through plain `fetch`, and behaviour is byte-for-byte what it is
today. When EFS confirms, you paste the material into the env vars and redeploy — no code change, no
risk to the non-mTLS path, and `POST /api/integrations/efs-soap/test-connection` proves the handshake
immediately (it now returns a `tls` field describing what's loaded).

Implemented on `node:https` rather than a fetch dispatcher on purpose: `node:https` takes
cert/key/ca/pfx natively, so no new runtime dependency enters the tree for a capability that may turn
out to be unnecessary.

```bash
# PEM pair (the usual case). Values are PEM TEXT, not file paths — Railway has no persistent
# secret files. Literal newlines or \n both work; use the _B64 variants if the env editor
# mangles multi-line values.
EFS_SOAP_CLIENT_CERT_PEM="-----BEGIN CERTIFICATE-----\n...-----END CERTIFICATE-----\n"
EFS_SOAP_CLIENT_KEY_PEM="-----BEGIN PRIVATE KEY-----\n...-----END PRIVATE KEY-----\n"
EFS_SOAP_CLIENT_KEY_PASSPHRASE=...      # only if the key is encrypted

# or base64 of the same
EFS_SOAP_CLIENT_CERT_B64=...
EFS_SOAP_CLIENT_KEY_B64=...

# or PKCS#12, if EFS hands you a .pfx/.p12 instead
EFS_SOAP_CLIENT_PFX_B64=...             # base64 of the file
EFS_SOAP_CLIENT_PFX_PASSPHRASE=...

# only if their endpoint is signed by a private/enterprise root Node doesn't trust
EFS_SOAP_CA_PEM=...        # or EFS_SOAP_CA_B64
```

Behaviour notes:

- Setting a cert **without** its key (or vice versa) throws at request time with an explicit message,
  rather than silently falling back to anonymous TLS and surfacing later as an opaque 403 from EFS.
- `GET /api/integrations/efs-soap/config` reports `tls` — a secret-free description of what is
  loaded. Check it after deploy.
- `EFS_SOAP_TLS_INSECURE=true` disables certificate verification. It exists only for a staging
  endpoint with a self-signed cert. Never set it in production; the status string shouts when it's on.
- Rate limiting, retries, priority lanes and the login/logout session flow are unchanged — the TLS
  material only changes the transport.

**What to ask EFS**, so you can configure it in one go rather than three round-trips:

1. Is a client certificate required on the production `CardManagementWS` endpoint, or is the source-IP
   allowlist the only access control?
2. If required — who issues it (do they issue it, or do we submit a CSR), and in what format
   (PEM pair or PKCS#12)?
3. Is their server certificate chained to a public root, or do we need their CA bundle?
4. Does the certificate carry any authorisation meaning (per-account identity), or is it purely
   transport-level? This decides whether one cert covers all orgs or we need per-org material — the
   current implementation is deploy-wide, which is right for a single EFS account.
