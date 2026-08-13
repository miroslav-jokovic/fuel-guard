# Devin task — EFS Phase 1A: security plumbing

## Context

Phase 1 closes the open doors found in the security audit. This task is **1A — the mechanical half**. The data-loss fix (`reportValue`) and the endpoint-binding access change are **1B** and are not in scope here.

## ⚠️ Step 0 — verify your base before touching anything

**This task requires Phase 0 in the base commit.** Without it you will hit pre-existing failures in `lint:filesize`, `typecheck` and `fuelCardsControl.test.ts` that Phase 0 already fixed, and Step 1's `experiments.ts` pin will not exist at all.

```bash
git fetch origin
git log --oneline -1 origin/main
git merge-base --is-ancestor origin/delivery-p0-green origin/main && echo "P0 MERGED" || echo "P0 NOT MERGED"
```

- **`P0 MERGED`** → branch `delivery-p1a-plumbing` from `origin/main`. Proceed.
- **`P0 NOT MERGED`** → branch from **`origin/delivery-p0-green`** instead, and open your PR **against `delivery-p0-green`, not `main`**. Say so in the PR title. Do not branch from `main`.

Then confirm the base is sound before writing any code:

```bash
pnpm install --frozen-lockfile && pnpm --filter @fuelguard/shared build:rn
pnpm lint:filesize && pnpm typecheck && pnpm test
```

**All three must pass on the untouched base.** If any fails, stop and report — you are on the wrong base.

Plan: `docs/28-EFS-EXECUTION-PLAN.md` §Phase 1. Audit evidence, if you want the reasoning: `docs/26-EFS-CARD-CONTROL-PLAN-AUDIT.md`.

## Rules

1. **Branch:** `delivery-p1a-plumbing`, off `main`. **One commit per step**, in the order given. A commit's diff contains nothing its step describes.
2. **Never weaken a gate.** No `.skip`, no deleted assertion, no loosened regex, no widened type to swallow an error, **no new filesize or funcsize waiver.** If a gate blocks you, that is a finding — stop and report.
3. **The stop rule stands and it worked well last time.** If reality differs from this document, stop and report rather than improvising. Three of your five Phase 0 stops were errors in the task, not the code.
4. `.github/workflows/ci.yml` is protected — put any needed diff in the PR body.
5. Leave pre-existing untracked files alone.

## Gates

Run the targeted gate after each step; all twelve before pushing. Matrix counts: `rls` **375** · `hazmat_rls` **38** · `load-lifecycle` **61** · `duty-sessions` **25**.

⚠️ **`apps/api/src/routes/fuelCards/experiments.ts` is pinned at 517 lines** in `check-file-size.mjs`, deliberately, because Step 1 adds to it. **Do not raise that pin.** If the file would grow, move something out of it into the new shared helper instead. That constraint is the reason the pin exists.

---

## Step 1 — Probe org-ownership and production guards

**The single most urgent item: the probe and experiment routers currently accept any card number from the request body with no org check.** Until this lands, an admin request carrying a production card number writes to a real production card — no ledger row, no rate limit.

**New file:** `apps/api/src/routes/fuelCards/probeGuards.ts`
**Wire into:** `probe.ts`, `writeProbe.ts`, `experiments.ts`
**Also:** `apps/api/src/env.ts`

**Do:**

Two exported guards in the new module. One helper, three call sites — not three copies.

```ts
/** Throws a 404-shaped refusal when the PAN is not a card in this org's mirror. */
export async function assertOrgOwnsCard(admin, env, orgId: string, cardNumber: string): Promise<void>

/** Throws a 403-shaped refusal when the resolved credentials point at production. */
export function assertProbeAllowed(env: Env, creds: EfsSoapCredentials): void
```

`assertOrgOwnsCard` uses **`cardRefHmac(env, orgId, cardNumber)`** — exported from `apps/api/src/services/efsCardMirror.ts:59` — and queries `efs_cards` on `card_ref_hmac` + `org_id`. Note the direction: `loadCardNumber` maps *card UUID → PAN* and is the wrong way round for these routers, which receive a PAN. Refuse with **404**, matching `control.ts`, so the response does not confirm whether a card exists in another tenant.

`cardRefHmac` calls `decodeSecretsKey(env)`, which throws when `SECRETS_ENCRYPTION_KEY` is absent or not 32 bytes. **Fail closed** — a missing key must refuse the request, never skip the check.

`assertProbeAllowed` refuses when `creds.environment === "production"` **or** the endpoint host is the production host, unless the new `EFS_ALLOW_PRODUCTION_PROBE` is `"true"`. Add it to `env.ts` beside `EFS_CARD_CONTROL_PROBE_ENABLED`, default `false`. Remember the parser is `s.toLowerCase() === "true"` — `1`/`yes`/`on` are silently false.

Call both **before any SOAP call** in every handler that takes a card number: `probe.ts` (`/diagnose`), `writeProbe.ts` (`/write-check`), `experiments.ts` (all five experiment variants, including `read_state`).

**Verify:**
- `assertOrgOwnsCard` refuses a PAN not in the org → 404
- …accepts one that is
- …refuses when `SECRETS_ENCRYPTION_KEY` is missing (fails closed)
- `assertProbeAllowed` refuses a production-environment credential, and allows it when the override is `"true"`
- `pnpm lint:filesize` — **`experiments.ts` still at or under 517**

---

## Step 2 — Remove the step-up `iat` fallback

**File:** `apps/api/src/middleware/requireFreshAuth.ts`

`hasFreshAuth` and `requireFreshAuth` both fall back to JWT `iat` freshness when no step-up token is present. The file's own docblock calls this DEPRECATED and says it is *"defeated by the refresh-token grant, which re-mints access tokens with a current `iat` and no password."* The web client already sends the token on every request (`apps/web/src/lib/api.ts` spreads `stepUpHeader()`), so the migration this was waiting on is done.

**Before you change anything:** grep for non-browser callers of the five step-up-protected routes. Two kinds, two different answers:

- **An automated caller** — anything in `scripts/`, `tools/`, a cron, a CI job, an integration — would break silently. **Stop and report.**
- **An operator runbook** — a `curl` a human copy-pastes from a `docs/` file — is documentation, and it breaks visibly on the next run. **Update it in this same commit.** Leaving a runbook that no longer works is the failure; stopping for one is not.

Known runbooks that need updating (verified: nothing in `scripts/` or `tools/` calls these):
- `docs/plans/DEVIN-PHASE0-EXPERIMENTS.md:71`
- `docs/plans/DEVIN-D1-DELETEOVERRIDE-EXPERIMENTS.md:51`

Both define an `exp()` shell helper that sends only `Authorization: Bearer $TOKEN`. Both rely on the `iat` fallback — note their instruction *"re-run whenever a call answers 403 `step_up_required`"*, which today means re-minting the Supabase token. After this step, re-minting that token will not help; the operator needs a step-up token.

**Add a mint step and the header to both.** Confirm the exact response field from `apps/api/src/routes/authStepUp.ts` rather than assuming:

```bash
STEP_UP=$(curl -s "$API/api/auth/step-up" -X POST \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"password\":\"$QA_ADMIN_PASSWORD\"}" | jq -r .<field>)

exp() { curl -s "$API/api/fuel-cards/experiment" -X POST \
  -H "Authorization: Bearer $TOKEN" -H "x-step-up-token: $STEP_UP" \
  -H "Content-Type: application/json" -d "$1"; }
```

The token TTL is **300s** (`STEP_UP_TOKEN_TTL_SEC`), so keep the re-run note but point it at the mint call instead of the Supabase grant.

**Do:** delete the `iat` branch from both functions; each reduces to `hasStepUpToken`. Keep `DEFAULT_STEP_UP_MAX_AGE_SEC` in the 403 payload — the web prompt reads it.

**Verify:** you repaired this test file in Phase 0; now invert its `iat` cases.
- *"a fresh iat alone no longer satisfies step-up"* — was passing, must now fail closed
- *"a valid step-up token passes"* · *"an expired token does not"* · *"a token minted for a different org does not"* — all still pass
- The two cases you added in Phase 0 must survive unchanged.

---

## Step 3 — Credential rotation must invalidate live sessions

**Files:** `apps/api/src/lib/efsSoapSession.ts`, `apps/api/src/services/efsSoapCredentials.ts`, `apps/api/src/routes/integrations.ts`

`__resetEfsSessions` is documented as *"call on credential change, so a rotated password cannot ride a cached session"* — and **nothing outside tests calls it.** The session key is `${orgId}:${endpointUrl}`, which contains neither the password nor the cert, so after rotating a leaked password every running process keeps writing with the old session for up to `EFS_SOAP_SESSION_TTL_MS` (20 min).

**Do, in this order — the two halves interact:**

**(a) Widen the session key.** Include a short hash of the password and the active client-cert fingerprint: `${orgId}:${endpointUrl}:${hash}`. A rotation then produces a *different* key, so the stale entry is never looked up again — self-healing even if a reset call is ever missed.

**(b) Make the reset prefix-based.** Because (a) changes the key, an exact-key reset can no longer find the old entry. Change `__resetEfsSessions` to accept an **org id** and clear every entry — sessions, in-flight logins, breakers, failure counters — whose key starts with `${orgId}:`. Keep the no-argument "clear everything" form the tests use.

**(c) Call it — as ONE named operation, not three loose calls.**

Three consecutive invalidations at four sites is +8 lines plus imports, which pushes `integrations.ts` past its 832 pin. Do not split that file and do not raise the pin. Collapse instead — these three always fire together, so give the coupling a name.

**New `apps/api/src/lib/soapCaches.ts`**, small, with a docblock recording *why* they are coupled — that knowledge is currently implicit across six call sites and will drift:

```ts
/** A credential change: the cached clientId and the policy cache both outlive it. TLS is unaffected. */
export function invalidateOrgSoapCaches(orgId: string): void {
  __resetEfsSessions(orgId);
  invalidatePolicy(orgId);
}

/** A certificate change: the above, plus pooled keep-alive sockets still presenting the OLD identity. */
export function invalidateOrgSoapIdentity(orgId: string): void {
  invalidateTlsAgents();
  invalidateOrgSoapCaches(orgId);
}
```

The distinction is real: a password rotation does not change the client certificate, so flushing the TLS agent pool for it would be gratuitous.

- `integrations.ts` lines **635, 755, 790, 824** → `invalidateOrgSoapIdentity(orgId)`, **one line replacing three**, in the same position (after the state change, before `writeAudit`). Keep the existing comment at `:753-754` explaining the keep-alive rationale.
- `upsertEfsSoapCredentials` and `disableEfsSoapCredentials` → `invalidateOrgSoapCaches(orgId)`.

Net effect on `integrations.ts`: **−8 lines of calls, −2 of imports**, landing at roughly **831** — under its pin, and one line better than the pre-Step-3 baseline.

**Then ratchet the pin down.** `check-file-size.mjs` prints the new number when a waived file shrinks, and its docblock says to lower it. A security step that *reduces* the largest waiver in the repo is the right shape.

**Verify:**
- *"a password change produces a different session key"*
- *"upserting credentials clears every cached session for that org"*
- *"disabling credentials clears the session and the policy cache"*
- *"activating a replacement certificate clears the session"*
- Existing `efsSoapSession` tests pass unchanged.

### Step 3b — split `efsSoapSession.ts` *(its own commit, immediately after Step 3)*

Step 3 pushes this file from 493 to 501 lines, over the 500 budget. It sat in the warn band beforehand, and `check-file-size.mjs`'s own docblock names this exact scenario: *"the gate therefore fires on whoever next touches one of them, for a reason unrelated to their change."*

**Do not waive it.** Split it — and split it where the seam actually is, not wherever gets under the number.

**Extract to a new `apps/api/src/lib/efsSoapFaults.ts`** — everything from `EfsSoapError` (~`:51`) through `responseResult` (~`:169`):

- `EfsSoapError`
- `FAULT_CODES`
- `faultError`
- `parseSoap`
- `responseValues`
- `responseResult`

That is one coherent concern — *how a SOAP response is read and its failures classified* — and it has **zero dependency on the session cache**, which does not begin until `:263`. What remains in `efsSoapSession.ts` is the connection lifecycle: the Maps, `sessionKey`, `__resetEfsSessions`, the breaker, `efsLogin`/`efsLogout`, `withEfsSession`, `acquire`, and `requestXml` (which belongs with the session because it consumes the session cookie).

**Re-export from `efsSoapSession.ts`** so no import site changes — the house pattern, as `efsCardXml.ts:9` already does for `efsCardCanonical.ts`.

This is the same reasoning that produced this file: `efsSoap.ts` was split into `efsSoap + efsSoapSession + efsXml` in August, and both it and `soapClient.ts` **left** the waiver list as a result. Splitting again along the same seam is consistent, not novel.

It also pre-positions **Step 5b** — the `flying j` fault code then lands in a small focused module instead of pushing a 500-line file back over.

**Verify:** `pnpm lint:filesize` green · `pnpm typecheck` · every existing test passes **unedited** (a re-export means no import site moves).

---

## Step 4 — Redaction hardening

**Files:** `apps/api/src/lib/efsCardXml.ts` (`redactCardXml`, ~`:394-409`), `apps/api/src/services/efsCardMirror.ts` (~`:489`)

Three gaps, all confirmed:

1. The digit mask is `\b\d{12,25}\b`, but the probe and experiment routers accept `^[0-9]{10,25}$`. A 10- or 11-digit PAN quoted back in a vendor fault message is **not masked** and lands in the ledger, the API response and `console.error`.
2. **`\b\d{12,25}\b` does not match `7083…111OVER`** — there is no word boundary between `1` and `O`. Inside a `<cardNumber>` element the element rule saves it; **inside a fault message it is emitted in the clear.** Phase 11 introduces exactly that card-number form.
3. The masked element list is `cardNumber|cardNum|CardNumber`. `transferCard` uses `fromCard` and `toCard` (Phase 13), which are not in it.

**Do:** widen the digit rule to `\b\d{10,25}\b`; add a rule covering a digit run with a short alphabetic suffix (`\b\d{10,25}[A-Z]{2,6}\b`); add `fromCard` and `toCard` to the element list. Apply the same to `efsCardMirror.ts`. **Do not touch `EFS_FAULT_REFERENCE`** — the 6–14 digit WEX support reference must keep surviving redaction; that carve-out is deliberate.

**Verify:**
- *"a 10-digit card number in a fault message is masked"*
- *"a card number with an OVER suffix is masked in a fault message"*
- *"transferCard's fromCard is masked"*
- *"a WEX support reference still survives redaction"* — the carve-out is not collateral damage
- Update the payload scanner **and every test that asserts the old 12+ bound**. Known: `apps/api/src/services/efsCardMirror.test.ts`, `apps/api/src/services/efsCardControl.test.ts`, `apps/api/src/lib/efsCardWrite.test.ts`. A scanner that still looks for 12+ digit runs cannot see the 10- and 11-digit PANs this step exists to mask.

---

## Step 5 — Small independent fixes

One commit each; each named for the defect it prevents.

**(a) `Idempotency-Key` becomes required.** `apps/api/src/routes/fuelCards/control.ts:81` — `z.string().uuid().optional()` → required; 400 when absent. The unique index is partial (`where idempotency_key is not null`), so an omitted header today means **no replay protection at all**.

⚠️ This will break every route test that omits the header — update them to send one, and **add** *"a mutation without an Idempotency-Key is refused"*. Grep for non-browser callers first; `useCardControl.ts` always sends one.

⚠️ **Specifically:** the Phase 0 test *"accepts a missing reason, but refuses a malformed one (B1)"* asserts `403 card_control_disabled` for a body with no reason. Once the key is required, that request 400s on the **key** before it ever reaches the gates. Add an `Idempotency-Key` to every request in that test so it keeps asserting what it was written to assert — the ordering of validation before the capability gate. **Do not change its expected statuses to match the new behaviour**; add the header so the original assertion still holds.

**(b) `flying j` fault classification.** `apps/api/src/lib/efsSoapSession.ts:90` — add `/flying\s*j/i` to `FAULT_CODES`. The EFS guide names this as a possible response on essentially every operation and it currently falls through as an untyped `soap_fault`.

**(c) `errorNumber` / `errorDesc` responses.** `apps/api/src/lib/efsCardWrite.ts` — `firstScalar` only returns a scalar from an element literally named `value` or `result`, so a response like `<result><errorNumber>…</errorNumber><errorDesc>…</errorDesc></result>` classifies as **success**. The mandatory re-read still catches it, but the outcome is recorded as `no_change` instead of the vendor's actual error. Recognise the shape and classify it as failed, carrying the vendor's text into the ledger.

**(d) `EFS_CARD_WRITE_TIMEOUT_MS` becomes real.** `env.ts:236` documents it as the whole-orchestration deadline, default 25s. Its only occurrence outside `env.ts` is a **comment**. Every vendor call passes the 10s interactive timeout instead, so there is no orchestration deadline at all — worst case is ~47s of a held HTTP request. Wire an `AbortController` spanning read → write → verify in `efsCardControl.ts`. On expiry the write is **not** retried and the row settles unverified.

**(e) Failed `writeAudit` becomes loud.** `apps/api/src/lib/audit.ts` retries once then returns `false`, and `efsCardReconcile.ts:148` ignores the return — so a mutation can land with no audit row and nothing says so.

**(f) `efs_card_mutations` into `RETENTION_FORBIDDEN`.** `apps/api/src/services/dataRetention.ts:148`. It is currently in neither the rules nor the forbidden list, so it is not pruned today but nothing stops someone adding a rule later. `dataRetention.test.ts` already asserts this list — extend that assertion.

**Verify:** one test per item, plus `pnpm test` green.

---

## Step 6 — Seal the SOAP password *(the migration)*

**Files:** new migration (allocate the number at execution time), `apps/api/src/services/efsSoapCredentials.ts`

`efs_soap_credentials.soap_password` is stored in **plaintext**, protected only by "service role, no RLS." This is the credential that authorises writes to a live fuel-card account, and `secretBox` already exists and is already used for TLS private keys.

**Do:** seal it with `secretBox`, AAD `(orgId, "efs_soap_password.v1")` — the same pattern as `efs_soap_client_key.v1`. The read path falls back to an unsealed legacy value so nothing breaks mid-deploy. One-shot backfill in the migration or a follow-up script.

This is the **first migration through the pipeline since 2026-08-12** — it is deliberately last in this branch so it is one isolated commit, and it is low-stakes on purpose.

**Verify:**
- *"a sealed password round-trips"* · *"an unsealed legacy row still reads"*
- `pnpm lint:migrations`, `pnpm lint:rls`
- `pnpm verify:live` after merge → new `schema.applied`, `drift: false`
- **Deployed:** a card read still works after backfill.

---

## Deliverable

Push `delivery-p1a-plumbing`, open a PR against `main`, **do not merge**. PR body, in order:

1. **Any urgent finding** — a non-browser caller of a step-up route (Step 2), a non-browser caller omitting `Idempotency-Key` (Step 5a), or `lint:filesize` pressure on `experiments.ts` (Step 1)
2. **Gate table** — all twelve, with matrix counts
3. **Any `ci.yml` diff** needed
4. **The migration number** you allocated, and the `verify:live` output
5. Anything that differed from this document

## Out of scope

- The `reportValue` prompt-deletion fix and `CardEdit.replaceAll.removals` — **1B**
- Endpoint/environment binding and the `endpoint_changed` gate — **1B**
- Anything touching `assertEchoFidelity`, `expectedCanonical`, or `editsLanded` — **Phase 2**
- Assigning QA card roles — do that *after* Step 1 merges, as a separate task
