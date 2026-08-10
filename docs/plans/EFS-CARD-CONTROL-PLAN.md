# EFS Fuel Card Control — Implementation Plan

## Context

FuelGuard's EFS integration is **read-only today**. `apps/api/src/lib/efsSoap.ts` authenticates against the WEX `CardManagementWS` SOAP endpoint and calls exactly four operations: `login`, `logout`, `getMCTransExtLocV2` (posted transactions), `getTranRejects` (rejected authorizations). There is **zero card-control code** anywhere in `apps/` or `packages/` — no `getCard`, no `setCard`, no cards page, no `/api/cards` route.

The consequence is that FuelGuard can *detect* fuel fraud but cannot *stop* it. When the product flags a suspicious fill, the only remedy is for someone to log into the WEX portal by hand. Card state in FuelGuard is inferred, not known: `fuel_cards` rows are produced by `learnCardAssignments` (≥5 attributed fills, ≥70% single-vehicle majority) rather than read from the vendor, and `fuel_cards.status` is free text unrelated to the EFS status enum.

This plan adds card control on the **same endpoint and the same login token** we already use. Intended outcome: an operator sees live EFS truth for every card, and — once write entitlement is proven — can lock a card, grant a one-time fuelling exception, and change pump prompts, each with a full before/after audit trail.

**Everything below is verified** against `docs/EFS LLC Card Web Service Integration Guide .pdf` (WEX OTR Card Management Web Service Reference, v12.0, July 2024) and against the codebase. Page references are to that guide. `docs/22-EFS-CARD-CONTROL.md` was checked line by line against the PDF and is accurate; this plan extends it with `getCardSummariesV2` (p45), the `A|H|U|I` status search letters including **`U` = Fraud**, the daily ~03:00 CT `clientId` expiry, and the `AccountLockedException` risk.

### User decisions (binding)

| Decision | Answer |
|---|---|
| EFS write entitlements | **Unknown** → read and write layers must be independently shippable with an explicit gate between them |
| Phase 1 scope | **Lock/unlock, one-time overrides, prompt (infos) updates** (+ the read layer, which every mutation requires) |
| Security | Role-gated approved users, full audit trail, best-practice controls recommended below |
| Commercial gating | My call — see §8 |

---

## 1. The vendor invariant that governs everything

`setCard`/`setCardV2` are **full-document writes, not patches** (p134, p137, verbatim):

> "Make sure you echo back all fields from the getCard response, changing the applicable fields. Only remove fields or blank them out if you intend to remove them. This method does not assume that only changed values are being changed… if the system drops that `<infos>` record in the setCard, the card will no longer have a Driver ID assigned."

Every mutation is `getCardv2` → mutate → `setCardV2` with a **complete echo**. A dropped element is a deletion. This single fact drives §2, §3 and §4.

Other verified vendor facts that shape the design:

- **Auth:** `login(user,password)` → `clientId` (32 chars), passed as the first field of every call. **`clientId` expires daily ~03:00 CT.** Errors: `InvalidClientId` (re-login), `InvalidLoginException`, `InvalidAccountException`, **`AccountLockedException`** (too many bad logins).
- **"No news is good news" (p9):** successful calls may return nothing. `setCardV2` output is "a successful response or a decline error with text". `setCardPin` returns `Result`; `-1` = error.
- Retry guidance (p9–10): 4xx except 429 not retriable, 429 and 5xx retriable, exponential backoff **with jitter**, cap retries. "Excessive polling may lead to account suspension by WEX IT."
- **Do not pin certificates** — EFS rotates without notice. TLS 1.2+. RFC 6265 cookie jars required for session isolation.
- `getCard` returns **card-level infos/limits/timeRestrictions only**, even when source is `BOTH`. Effective config needs `getPolicy` (p84). "Card level always trumps policy."
- All EFS servers are **Central Time**; datetimes are ISO 8601.
- Override recipes (p194) are exact and must be followed literally, including the `cardNumber + "OVER"` convention for refreshing-limit overrides.

---

## 2. SOAP transport and session layer

### 2.1 Extraction (Phase 0, no behaviour change)

`apps/api/src/lib/efsSoap.ts` is **518 lines** and is `GRANDFATHERED` in `scripts/check-file-size.mjs` **pinned at 519** — one line of headroom. Card operations cannot go in that file. Everything they need (`requestXml`, `login`, `logout`, `parseSoap`, `elementToValue`, `xmlEscape`, `cookieHeader`, `findDescendant`, `childElements`, `localName`, `asRecords`, `textValue`, `responseValues`, `responseResult`) is private to it.

**New `apps/api/src/lib/efsSoapSession.ts`** — transport, session, XML primitives, moved verbatim then extended. `efsSoap.ts` shrinks to ~300 lines (two feeds, `pingEfsSoap`, `FEED_OPERATIONS`, row mapping) and **re-exports** `EfsSoapError`, `buildSoapEnvelope`, `buildAuthHeader`, `soapFetch` so no existing importer changes. Then **lower or delete its `GRANDFATHERED` pin** — the script prints the new number.

`requestXml`'s positional tail (`fetchImpl?, retry?, cookie?`) becomes an options object; card ops add `timeoutMs` and `signal`.

New files: `efsCardXml.ts` (document model, §3), `efsCardOps.ts` (WSDL operations), `services/efsCardControl.ts` (plan/apply orchestration), `services/efsCardMirror.ts` (summaries sweep + `fuel_cards` linking).

### 2.2 Session reuse — cached, single-flight, shared breaker

**Reuse sessions per org; do not log in per call.**

```ts
withEfsSession(env, creds, priority, fn)   // in efsSoapSession.ts
```

- Cache keyed `${orgId}:${endpointUrl}`; `expiresAt = min(now + 20min, next 03:00 America/Chicago − 5min)`.
- **Single-flight login:** N concurrent lock requests produce exactly one login.
- On `session_expired` (`InvalidClientId`): drop, re-login **exactly once**, re-run. A second failure throws. Never a loop.
- On `InvalidLoginException` / `InvalidAccountException` / `AccountLockedException`: open a **circuit breaker** for `EFS_LOGIN_BREAKER_MS` (30 min), stamp the credentials row, Sentry event + settings-page banner, rethrow.

**Why this is the most important control in the plan:** the service account also drives transaction ingestion. A retry storm from card control that trips `AccountLockedException` kills the fuel feed. The breaker lives in **one module used by card control and both feed schedulers**, so a bad credential stops everything loudly instead of three callers racing into a lockout.

`pingEfsSoap` keeps login-per-probe (it must *prove* a login works) but consults the breaker first.

### 2.3 A third priority lane

`SoapPriority = "live" | "backfill" | "interactive"`. Do **not** re-split `EFS_SOAP_MAX_RPS` three ways — that slows the existing pollers and breaks `soapLaneRps`'s tests. Give `interactive` its own budget:

```ts
if (priority === "interactive") return Math.max(0.1, env.EFS_SOAP_INTERACTIVE_RPS ?? 1);
```

The pacing slot key is already `${credentialKey}:${priority}`, so isolation is free. Document in `env.ts` that total offered load becomes `EFS_SOAP_MAX_RPS + EFS_SOAP_INTERACTIVE_RPS`. Rejected: reusing `"live"` — the rejected-transaction poller is the fraud signal and must not queue behind lock requests.

### 2.4 Request timeouts (currently missing entirely)

`soapFetch` sets no `AbortSignal` on either the `fetch` or the `node:https` branch. Add `timeoutMs` to `SoapRequestOptions`: `AbortSignal.timeout()` on the fetch branch, `req.setTimeout(…, () => req.destroy(…))` on the https branch. Defaults `EFS_SOAP_TIMEOUT_MS` 20 000, `EFS_SOAP_INTERACTIVE_TIMEOUT_MS` 10 000, orchestration deadline `EFS_CARD_WRITE_TIMEOUT_MS` 25 000.

⚠️ **A `setCardV2` timeout is not a failure — the write may have landed.** It is always dispatched with `retry: false` and reconciled by re-read (§5.5), never retried.

### 2.5 Error classification

Extend `EfsSoapError.code` with `"session_expired"`, `"account_locked"`, `"declined"`, `"echo_unfaithful"`. Add a fault-name lookup checked **before** the existing substring regex in `parseSoap`, and read `<faultcode>`/`<detail>` local names, not just `faultstring`.

---

## 3. The full-echo round trip — the crux

### 3.1 Echo from the raw DOM, never from a typed model

**Build the `setCardV2` body by transforming the DOM of the `getCardv2` response.**

| Hazard | Typed-model serializer | Raw-DOM echo |
|---|---|---|
| `elementToValue` collapses 1 vs N records | Must be fixed; can regress silently | Never parsed that way |
| `xsi:nil` on `originalStatus` | Modelled per field | Attribute survives verbatim |
| **Undocumented / future fields WEX adds** | **Silently dropped → card data destroyed** | Survives verbatim |
| `boolean(1)` rendered `0/1` vs `true/false` | We must guess | Untouched fields go back byte-identical |
| Element ordering | Must be encoded | Document order preserved |

Row three is decisive. The invariant is *anything you drop, you delete*, and WEX ships schema changes without notice. A typed model can only echo fields it knows about.

### 3.2 `apps/api/src/lib/efsCardXml.ts`

```ts
interface CardDocument {
  dom: XmlDocument;        // THE source of truth for the echo
  root: XmlElement;
  card: WSCard;            // typed, lossy VIEW — for UI/validation only, never serialized back
  version: string;         // optimistic-concurrency token
  redactedXml: string;     // PAN-redacted, safe to persist
}

type CardEdit =
  | { op: "setHeader"; name: string; value: string }
  | { op: "setHeaderNil"; name: string }
  | { op: "removeAll";  name: "infos"|"limits"|"locations"|"locationGroups"|"timeRestrictions" }
  | { op: "replaceAll"; name: …; records: Record<string,string|null>[] }
  | { op: "appendRecord"; name: …; record: Record<string,string|null> };

parseCardDocument(xml): CardDocument
serializeSetCardRequest(doc, clientId, edits): { xml, redactedXml }
assertEchoFidelity(doc, requestXml, edits): void    // runs in PRODUCTION on every write
redactCardXml(xml): string
cardVersion(root): string
```

`serializeSetCardRequest` clones `root`, applies edits to the clone, renames the wrapper to `CardManagementEP_setCardV2`, inserts `<clientId>` first, serializes. Untouched elements keep original text and attributes.

**`assertEchoFidelity` is the safety mechanism.** Canonicalise both documents to a field-path multiset (`/status`, `/infos[]/infoId`, …; nil is a distinct sentinel); apply `edits` to the response multiset to compute the expected request multiset; diff. Any difference → throw `"echo_unfaithful"` and **the request is never sent**. Cost: microseconds. Benefit: the fleet-wide-data-loss disaster becomes structurally impossible rather than test-covered.

### 3.3 The typed view

`WSCard` lives in **`packages/shared/src/cardControlContract.ts`** as zod schemas so API and web share one definition. Parsing rules that matter:

- **1-vs-N:** use a new `collectRecords(root, name): XmlElement[]` that always returns an array. **Leave `elementToValue` untouched** — changing it would alter transaction ingestion.
- **Empty vs absent:** `infos: []` means "the card has no prompts". "Don't touch prompts" is the *absence of an edit*. This is exactly why mutations are a `CardEdit[]` rather than a mutated object.
- **`override` and `locationOverride` are not booleans** despite `boolean(1)`: `override` carries 0–9 remaining uses, `locationOverride` carries a 6-digit location id. Surface as `overrideUses: number` and `locationOverrideId: string`. `overrideAllLocations` is a real boolean.
- **Datetimes:** new `packages/shared/src/efsTime.ts` — `efsDateTime(d)` formats `America/Chicago` via `Intl.DateTimeFormat` (no new dependency); `parseEfsDateTime(s)` → ISO. `timeRestrictions.beginTime` carries a meaningless `1970-01-01` date part preserved verbatim; Phase 1 never edits time restrictions.

### 3.4 `cardVersion` — the concurrency token

`sha256(canonicalMultiset(root, { exclude: ["lastUsedDate","lastTransaction","beingOverridden"] }))`. Excluding volatile fields is not cosmetic: `lastUsedDate` changes on every fill and would 409 a dispatcher who opened the drawer while the truck was fuelling. Whitespace and attribute order normalise away.

### 3.5 Persistence posture

**Do not persist raw XML for the echo.** Every mutation performs a fresh `getCardv2` inside the same operation — that is the guide's recipe and what makes `expectedVersion` meaningful. Stored XML is forensic and PAN-redacted.

---

## 4. Data model

### 4.1 New tables, not an extension of `fuel_cards`

`fuel_cards.card_ref` is a `cardIdentityKey()` — full PAN *when available*, else `"<last4>|<controlId>"`. Rows are written by `syncCardAssignments`/`learnCardAssignments` and are load-bearing for attribution. Conflating vendor truth with derived attribution lets the mirror sweep and the learner corrupt each other, and breaks on the first card that exists in EFS but has never transacted.

Rejected: adding `efs_status` / `efs_document` / `efs_synced_at` columns to `fuel_cards`.

### 4.2 Migrations (next free number is 0171; latest applied is 0170)

**`0171_efs_cards.sql`** — the mirror.

Key columns: `id`, `org_id`, `fuel_card_id` (nullable, `on delete set null`), `card_last4` (check `^[0-9]{4}$`), `card_ref_hmac`, `card_number_sealed`, the EFS header fields (`status`, `original_status`, `payroll_status`, `policy_number` 1–99, `company_xref`, `hand_enter`, `info_source`/`limit_source`/`location_source`/`time_source`, `override_uses` 0–9, `override_all_locations`, `location_override_id`), denormalised `driver_id_prompt` / `unit_prompt` / `driver_name` for search, `last_used_date`, `document jsonb` (the typed view), `card_version`, `last_response_xml_redacted`, `synced_at`, `sync_error`.

- `unique (org_id, card_ref_hmac)`; indexes on `(org_id, status)`, `(org_id, synced_at)`, `(org_id, card_last4)`, partial on `fuel_card_id`.
- Status check includes **`Fraud`** — the `U` state from `getCardSummariesV2` search is absent from the `getCard` enum.
- `enable row level security` with **no policies** (service-role only, same posture as 0091/0106) — the row carries the sealed PAN and the whole document.

**Card number storage:** `card_number_sealed` = `seal(env, pan, secretAad(orgId, "efs_card_pan"))` via the existing `lib/secretBox.ts`. `card_ref_hmac` = HMAC-SHA256 over `orgId + ":" + pan` with an HKDF subkey of `SECRETS_ENCRYPTION_KEY` (`info: "efs-card-ref"`) — deterministic so it can be uniquely indexed, keyed so it is not brute-forceable (a bare SHA-256 of a card number with a known BIN and known last4 is a few million guesses), org-bound so the same PAN in two orgs does not correlate. We must hold the PAN to call `getCardv2`; the alternative is retyping a card number per action, which is not a product. `SECRETS_ENCRYPTION_KEY` unset → refuse to write rows, route returns 422, matching `saveSamsaraToken`.

**`0172_efs_card_mutations.sql`** — the ledger.

`intent` ∈ `lock|unlock|override_grant|override_clear|prompts_set`; `status` ∈ `pending|sent|succeeded|failed|drift_detected`; `requested_by`; **`approved_by` (nullable, reserved for maker-checker — the column exists now so §6.7's seam needs no schema change)**; `reason` (3–200 chars, required); `expected_version`; `before_document` / `after_document` / `edits` jsonb; redacted before/request/response XML; `efs_fault_code` / `_message`; `reconciled_version`; `drift` jsonb; `idempotency_key`; `attempts`; timestamps.

Indexes on `(efs_card_id, created_at desc)`, `(org_id, created_at desc)`, a partial for the hourly blast-radius cap, and `unique (org_id, idempotency_key) where idempotency_key is not null`. RLS enabled, no policies.

**`0173_efs_card_control_settings.sql`** — `efs_card_control_settings (org_id pk, enabled default false, write_entitlement 'unknown'|'confirmed'|'denied' default 'unknown', probe_result jsonb, probed_at, probed_by, require_approver default true)` and `efs_card_control_approvers (org_id, user_id, scopes text[] default array['lock','unlock','override','prompts'], granted_by, granted_at)`. RLS enabled, no policies.

**`0174_card_write_counters.sql`** — mirror of 0149: `card_write_counters` + RPC `bump_card_write_counter(p_org, p_user, p_bucket, p_limit)`.

All four migrations follow the `0152_dq_exports.sql` voice: a long `--` header explaining *why*, inline column comments, named checks, and a `trg_x_updated before update … execute function set_updated_at()` trigger (the function exists in `0002_functions.sql`).

### 4.3 Linking to `fuel_cards`

`efsCardMirror.linkFuelCard`: full PAN → match `fuel_cards.card_ref`; else match `card_last4` + the DRID/CNTN prompt via `cardIdentityKey` / `cardRefsMatch` from `packages/shared/src/cardAssignment.ts`. Exactly one match → set `fuel_card_id`; zero or several → leave null, record `sync_error: "ambiguous_fuel_card_link"`. **Never writes back to `fuel_cards`** — attribution stays `syncCardAssignments`'s job and its `assignment_source='manual'` guard stays intact.

---

## 5. API surface

### 5.1 Files and mounts

```
apps/api/src/routes/fuelCards/read.ts     → fuelCardsRouter()        (~220 lines)
apps/api/src/routes/fuelCards/control.ts  → fuelCardControlRouter()  (~280 lines)
```

Mounted in `app.ts` as two routers on one prefix (the `rosterDriversRouter` precedent), each starting with `router.use(requireAuth)` so `routeAuth.test.ts` discovers both automatically. Add `/api/fuel-cards` to the `strictLimiter` list alongside `/api/integrations`.

**Every route keys on `efs_cards.id` (uuid), never a card number** — no PAN in access logs, `Referer`, or browser history.

### 5.2 Read routes (Phase A)

| Method | Path | Gate | Response |
|---|---|---|---|
| GET | `/api/fuel-cards` | `rolesThatCanView("fuel")` | `{ cards, total }` |
| GET | `/api/fuel-cards/:id` | view | `{ card, effective, links, capabilities, synced }` |
| GET | `/api/fuel-cards/:id/history` | view | `{ mutations }` |
| POST | `/api/fuel-cards/:id/refresh` | view | `{ card, version }` — synchronous `getCardv2` |
| POST | `/api/fuel-cards/sync` | `rolesThatManage("fuel")` | 202 — `efs_card_sync` job |
| GET | `/api/fuel-cards/locations` | view | `searchLocation` results |
| GET | `/api/fuel-cards/policies/:policyNumber` | view | `getPolicy`, 15-min cache |

`effective` is the card/policy merge computed server-side (`mergeEffectiveConfig` in the shared contract) so "card level trumps policy" lives in one place. `capabilities` is computed server-side, never inferred by the client: `{ canLock, canUnlock, canOverride, canSetPrompts, writeEntitlement, blockedBy }`.

Verified role expansion: `rolesThatCanView("fuel")` = admin, fleet_manager, dispatcher, safety_manager, auditor. `rolesThatManage("fuel")` = admin, fleet_manager.

### 5.3 Write routes (Phase B) — one endpoint per intent

```
POST   /api/fuel-cards/:id/lock
POST   /api/fuel-cards/:id/unlock
POST   /api/fuel-cards/:id/override
DELETE /api/fuel-cards/:id/override
POST   /api/fuel-cards/:id/prompts
```

All `rolesThatManage("fuel")` + approver check + `cardWriteLimit()`, all requiring `reason` and `expectedVersion`.

Rejected: a generic `PATCH` accepting a partial `WSCard`. It puts vendor-document shape on the wire, makes the audit action indeterminable without diffing, makes per-intent rate limits and approver scopes impossible, and invites the "just send what changed" mental model the EFS invariant punishes.

Schemas in `packages/shared/src/cardControlContract.ts`. Two deliberate shapes:

- `setPromptsSchema` requires `replaceAll: z.literal(true)` — full-replace semantics can never arrive from an omitted field.
- Removing the DRID record requires `allowRemoveDriverId: true` **and** step-up. That is the exact failure the guide warns about, made impossible by accident rather than merely discouraged.
- Phase 1 `EDITABLE_INFO_IDS = ["DRID","UNIT"]`, `validationType` restricted to `EXACT_MATCH | REPORT_ONLY`, `matchValue` max 24 chars (vendor limit).

### 5.4 Synchronous, not queued

The operation is `getCardv2` → `setCardV2` → `getCardv2` (verify): ~2–4 s at `EFS_SOAP_INTERACTIVE_RPS = 1`. "Locked" must mean *EFS says Hold, verified* — a 202 plus a job poll gives a dispatcher a spinner and a page they may close, and at 2 a.m. when a truck has been broken into, "queued" is the wrong word. The queue is also the wrong tool: `dispatchJob`'s per-(org,kind) slot would serialise all card writes for an org, and its `dedup_key` would 409 two dispatchers locking two *different* cards.

Guardrails: the 25 s orchestration deadline; a per-**card** in-process mutex (cross-instance, `expectedVersion` catches it); `strictLimiter` + `cardWriteLimit` + the org hourly cap; and the `pending` ledger row written **before** dispatch so a crash leaves a visible row, not silence.

The queue keeps exactly one Phase-1 job: `efs_card_sync` (mirror sweep), `KIND_CAPS: { efs_card_sync: 1 }`, daily scheduler modelled on `efsIngestScheduler.ts`.

### 5.5 Concurrency, idempotency, reconciliation

**`expectedVersion`.** Client sends the version it rendered. Server does a fresh `getCardv2`; mismatch → **409 `card_state_changed`** with `currentVersion` and the fresh card, nothing sent to EFS. This is the only defence available — the guide has no ETag or row version.

**Idempotency.** Accept an `Idempotency-Key` header (uuid v4) on all five write routes; enforced by the partial unique index, not a read-then-write race. Replay of a settled key → 200 `{…, idempotent: true}` (the `routes/meHazmat.ts:148` shape); replay of an in-flight key → 409 `mutation_in_flight`. This is the repo's first HTTP-level idempotency, justified because the failure mode of a double-submitted override is a driver getting two free tanks.

**Reconciliation — one path for every outcome:**

```
1. mark ledger 'sent'
2. dispatch setCardV2 (retry:false — a retried write is a second write)
3. ALWAYS re-read getCardv2
4. classify:
   intent landed, nothing else moved  → 'succeeded'
   intent landed, other fields moved  → 'drift_detected' + audit card.drift_detected
   intent did not land                → 'failed' + efs_fault_*
   step 3 itself failed               → 'sent' (terminal-unknown) + audit card.mutation_unverified
```

**The mirror is updated from the re-read in every branch, including failure** — a failed write still teaches us the true state. "We don't know" is a first-class recorded outcome, not a swallowed exception.

Success detection per "no news is good news": HTTP 2xx, no Fault, no `Result` element = success; `Result -1` or a decline pattern = `"declined"`. The probe (§7) records the *actual* observed success shape and this classifier is tightened to match before Phase B ships.

### 5.6 Probe endpoint

`POST /api/integrations/efs-soap/card-control-probe` — lives next to `test-connection` (same admin page), `requireRole("admin")` + `requireFreshAuth(300)`, gated on `EFS_CARD_CONTROL_PROBE_ENABLED`, body `{ cardNumber }` **never persisted**. Writes `efs_card_control_settings.probe_result/probed_at/probed_by/write_entitlement` and audits `integration.efs_soap.card_control_probed` (meta carries step outcomes and `cardLast4`, never the PAN).

### 5.7 Status codes

Beyond the house vocabulary: `403 card_control_disabled` (kill switch or org off), `403 card_control_not_entitled`, `403 step_up_required` (carries `maxAgeSec`), `409 card_state_changed`, `409 mutation_in_flight`, `422 secrets_key_missing`, `502 efs_soap_<code>`, and **`502 efs_echo_unfaithful`** — a distinct code because that is a bug in us, not a vendor problem, and must be visible as such. A cross-org `:id` returns **404, not 403** — we never confirm another org's card exists.

---

## 6. Security controls

### 6.1 Role gate + explicit approver list

Writes require `rolesThatManage("fuel")` **and** membership in `efs_card_control_approvers` for the relevant scope. `require_approver` **defaults to true**, so switching card control on cannot silently hand write access to every existing fleet manager — an admin must name at least one person. `scopes text[]` allows granting `['lock','unlock']` without `override`, the most-requested split. Org-level settings (`enabled`, `require_approver`, approver grants) are `requireRole("admin")` only.

Rejected: giving `dispatcher` write access. A dispatcher granting overrides is precisely the fraud pattern this product exists to detect; if a customer wants it, they name that person as an approver — an audited act — rather than changing a role that also grants unrelated permissions.

### 6.2 Per-user write throttling

New `packages/shared/src/cardWriteLimits.ts` + `apps/api/src/middleware/cardWriteLimit.ts`, shaped like the existing `driverWriteLimit`: in-memory per-minute burst window keyed on JWT `sub` (checked first, so a retry loop never touches the DB), then a durable daily cap via `bump_card_write_counter`. Distinct codes for `rate_limited` (seconds) vs `daily_cap_reached` (hours).

Buckets: `card_status` 10/min 100/day, `card_override` 5/min 25/day, `card_prompts` 10/min 50/day.

**Deliberate deviation:** `card_override` and `card_prompts` **fail closed** when the counter is unreachable. The driver limiter fails open because refusing a completed stop loses real work; here, failing open grants unmetered free fuel. Comment it so the inconsistency reads as a decision.

### 6.3 Step-up re-authentication

New `apps/api/src/middleware/requireFreshAuth.ts` reading the verified JWT's `iat` — costs nothing and needs no new table, since `requireAuth` already verifies via JWKS. The web re-authenticates with `supabase.auth.signInWithPassword` in a small `StepUpPrompt.vue` and retries.

Required for: enabling card control, granting/revoking approvers, running the probe, an override with `uses > 3`, and any prompts change that removes DRID. **Not** for a single lock/unlock — that is the safety action you want frictionless at 2 a.m., and it is fully reversible.

Rejected: a `step_up_tokens` table (more state, same guarantee) and TOTP/WebAuthn (building MFA infrastructure the repo lacks, for one feature). Caveat to document: an SSO-only org has no password to re-enter, so `requireFreshAuth` degrades to token freshness — pair it with `requireRole("admin")` on org-level settings.

### 6.4 Blast-radius caps

1. **No bulk endpoint exists in Phase 1.** No route can touch more than one card. This is the primary cap and it is structural.
2. `EFS_CARD_MAX_MUTATIONS_PER_HOUR` (default 50), org-wide, counted from the ledger. Per-user limits do not stop three collaborating accounts; this does.
3. Override uses are vendor-capped 1–9; we cap at 3 without step-up.
4. DRID removal needs the explicit flag **and** step-up.
5. **Kill switch** — one function `assertCardControlEnabled(env, settings)` ANDs four facts before any write reaches a service: `env.EFS_CARD_CONTROL_ENABLED` (default **false**) ∧ `efs_soap_credentials.enabled` ∧ `efs_card_control_settings.enabled` (default **false**) ∧ `write_entitlement === 'confirmed'`. Read routes are unaffected — turning off writes must not blind the operator.

### 6.5 PAN handling, end to end

| Surface | Rule |
|---|---|
| API responses | `{ id, last4, maskedRef }` only; `card_number_sealed` never in a `select()` list, explicit column literals, never `select("*")` |
| URLs | uuid only |
| Audit `meta` | `cardLast4` + `efsCardId` |
| Persisted XML | `redactCardXml()` first — `<cardNumber>`/`<cardNum>` content **and any 12–25 digit run** → `••••NNNN` |
| Logs | same redactor wraps every `console.error` that could carry a body |
| Sentry | extend `lib/sentryScrub.ts` with the digit-run redaction in `beforeSend` **and** `beforeSendBreadcrumb` — an `EfsSoapError` whose vendor message quotes a card number must not ship a PAN |
| Web | `maskPan(last4)` only, per `useCardAssignments.ts`'s existing rule |

⚠️ `getCardSummariesV2` returns full PANs for the **entire fleet in one body**. It must never be logged, stored raw, or included in an error path. `efsCardMirror` redacts before any error is raised from that code path.

### 6.6 Audit vocabulary

Entity `efs_cards`, dotted `noun.verb_past`:

```
card.control_enabled   card.control_disabled
card.approver_granted  card.approver_revoked
card.locked            card.unlocked
card.override_granted  card.override_cleared
card.prompts_changed
card.mutation_failed   card.mutation_unverified   card.drift_detected
integration.efs_soap.card_control_probed
```

Applying the `AUDITED_VALUE_FIELDS` rule from `routes/roster/drivers.ts:66`: card control is *entirely* compliance-relevant, so `meta` carries **values** — `statusBefore/After`, `overrideUsesBefore/After`, `overrideScope`, `locationId`, `promptsBefore/After` (infoId, validationType, matchValue), `expectedVersion`, `resultVersion`, `outcome`, `efsFaultCode`, `reason`, `stepUp`, `driftFields`. `matchValue` is a driver ID or unit number — operational data an auditor asks about, not a secret. **Never** in `meta`: the PAN, the `clientId`, the SOAP password, raw XML.

`reason` is required on every write. Cheapest column in the schema, most valuable one six months later.

### 6.7 The request → apply seam

```ts
planCardMutation(ctx, intent)  // getCardv2 → verify version → build CardEdit[] → dry-run
                               // assertEchoFidelity → INSERT ledger 'pending' → { mutationId, plan }
applyCardMutation(ctx, plan)   // re-verify → setCardV2 → reconcile → finalize → audit → mirror
```

Phase 1 routes call both in one request. Maker-checker later inserts an approval between them **with zero change to the write path**: the route returns 202 `{mutationId}`, and `POST /mutations/:id/approve` calls `apply`, which re-validates `expected_version` so a stale approval is refused rather than applied blind. `approved_by` already exists on the ledger. Splitting now is the entire reason it is cheap later.

### 6.8 Not locking the service account — checklist

One session cache + single-flight login per org · proactive expiry (min of 20 min and 02:55 CT) · exactly one re-login on `session_expired`, never on any other auth code · a **shared** breaker used by card control and both feed schedulers · a test proving `soapFetch` does not retry a login fault (a SOAP Fault arrives as HTTP 200, so it never enters the 429/5xx retry branch — currently a load-bearing accident, made a stated property) · the probe env-flag gated and breaker-aware · `pingEfsSoap` behind `strictLimiter`.

---

## 7. Frontend

### 7.1 Routes, nav, settings hub

```ts
{ path: "/fuel-cards",      name: "fuel-cards",       meta: { requiresAuth, title: "Fuel Cards" } }
{ path: "/fuel-cards/:id",  name: "fuel-card-detail", meta: { requiresAuth, title: "Fuel Card", parent: "/fuel-cards" } }
{ path: "/settings/card-control", name: "card-control-settings",
  meta: { requiresAuth, requiresAdmin: true, title: "Card Control", parent: "/settings" } }
```

No `requiresManage` on list/detail — read is open to the five fuel-viewing roles and the drawer's actions gate themselves from `capabilities`.

`lib/nav.ts`, Fuel section after Rejections: `{ name: "Cards", to: "/fuel-cards", icon: CreditCardIcon, show: canViewSection(role, "fuel") }`. Requires adding `CreditCardIcon` to the curated barrel `packages/ui/src/icons.ts` first — never import from `@hugeicons/core-free-icons` in app code. Extend `nav.test.ts`.

`SettingsPage.vue` `configCards`: `{ name: "Card control", to: "/settings/card-control", icon: LockIcon, desc: "Who can lock cards and grant overrides, and the EFS write access check.", show: session.admin }`.

### 7.2 Feature directory

```
apps/web/src/features/fuelCards/
  useEfsCards.ts  useCardControl.ts  useEfsLocations.ts
  cardControlModel.ts            (PURE — availability matrix, prompts diff, confirmation copy)
  CardControlDrawer.vue          CardStatusPanel.vue  CardOverridePanel.vue  CardPromptsPanel.vue
  EfsLocationPicker.vue          CardEffectiveConfig.vue  CardMutationHistory.vue
  cardControlModel.test.ts       CardControlDrawer.test.ts  EfsLocationPicker.test.ts
```

Each composable follows the `useHazmatLoads.ts` template: `const efsCardsKey = [...] as const`, a private `call<T>()` that throws so vue-query sees errors, `useQuery({ queryKey: computed(...) })`, mutation factories invalidating in `onSuccess`. `useCardControl` mints one `crypto.randomUUID()` per drawer-open per intent as the `Idempotency-Key` and always sends the rendered `expectedVersion`.

**Feature-boundary fix:** `maskCardRef` currently lives in `features/fueling/useCardAssignments.ts`, and `check-feature-boundaries.mjs` forbids `features/fuelCards` importing it. Move it to `packages/shared/src/cardAssignment.ts` as `maskPan(last4)` and re-point the existing consumer — the correct fix rather than duplicating a masking rule.

### 7.3 The three Phase-1 interactions

`CardControlDrawer.vue` copies `DriverAccessModal.vue` (498 lines, "the best drawer code in the repo") exactly: a typed `ConfirmAction` union, a `confirmation` computed returning `{icon, tone, title, body, confirmLabel}`, the confirmation **replacing the drawer body** (never a stacked modal — there is no centred modal component and this is the better pattern anyway), a `busy` computed OR-ing all mutations, and a `#footer` that swaps with body state.

**Lock / unlock** — `CardStatusPanel.vue`: status badge via `statusTone` from `@/lib/badges.ts`, last used, linked vehicle/driver, and a required Reason `FormField` with hint `"Recorded in the audit log."` The primary button stays disabled until the reason is valid — the reason is typed *before* the decision.

> `Lock this card?` · danger · "The card stops working at every location immediately. Fuel purchases will decline until you unlock it." · `Lock card` / `Locking…` / toast `Card locked`

**One-time override** — `CardOverridePanel.vue`: Uses (`ComboSelect` 1–9, default 1, hint "The exception is used up automatically."), scope All locations / One location. `One location` opens `EfsLocationPicker.vue` — a `SearchInput` plus a dense `DataTable` of `searchLocation` results (`name, city, state, locId`) with a `#actions` Select button, collapsing to a one-line summary. The confirmation names the numbers:

> "This card will be allowed 2 purchases outside its normal limits at Loves #442, Effingham IL. The exception is used up automatically."

**Prompts** — `CardPromptsPanel.vue`: a dense `DataTable` of current infos (`infoId` through `EFS_INFO_LABELS`, `validationType` as a badge, `matchValue`), only DRID and UNIT editable, `maxlength=24`, hint "Maximum 24 characters. The driver must enter exactly this at the pump." Clearing DRID switches to the `removeDriverId` confirmation ("The pump will stop checking who is fueling…") and requires step-up.

Failures everywhere use the house idiom: `toast.error("Could not lock card", e instanceof Error ? e.message : undefined)`. A 409 gets a bespoke handler — refetch, then `toast.error("Card changed in EFS", "Review the current settings and try again.")`, drop back to the drawer body with fresh data. No inline banner, no local `saveError` ref.

### 7.4 The read-only detail page

`FuelCardDetailPage.vue`, thin (logic in `cardControlModel.ts`), renders **no `<h1>`** (AppShell owns it from `meta.title`):

- `PageHeader` with `#actions`: `Card actions…` (trailing ellipsis — it opens a drawer) plus a `KebabMenu` with `Refresh from EFS`.
- Summary `BaseCard`: masked ref, status badge, policy, company XRef, payroll status, hand entry, last used, linked vehicle/driver, and a freshness line — `Checked 3 minutes ago.`, escalating past 60 minutes to a caution-toned `Last checked over an hour ago. Refresh to see current settings.`
- **`CardEffectiveConfig.vue`** — three `DataTable`s (Prompts, Limits, Time restrictions) rendering the card/policy merge. Each row carries a source badge (`brand` = Card, `info` = Policy). Where a card record and a policy record share a key, the card row renders normally and the policy row renders directly beneath in `text-ink-subtle` with an `Overridden by card` badge — *that layout is the visualisation of "card level always trumps policy"*. The source mode is stated in words above each table (`Prompts come from both the card and policy 14.`). **Limits carry units from the shared map — gallons for fuel/DEF limit IDs, dollars otherwise.** Getting this wrong makes a 100-gallon cap look like a $100 cap.
- `CardMutationHistory.vue`: when, who, what, reason, outcome. `emptyText: "No changes yet."` Unverified rows carry a caution badge.

### 7.5 When write entitlement is unconfirmed

Driven by `capabilities.writeEntitlement` + `blockedBy`:

- **`unknown`** — panels render **disabled with one explanatory line**, not hidden: *"Card actions are not switched on yet. An admin needs to run the EFS write check."* plus, for admins, a soft button to the settings page. Hiding them makes Phase A look like a dead end and generates tickets asking for a feature that is already built.
- **`denied`** — *"EFS has not enabled card changes for this account. Ask your WEX representative to add write access for the service account."*
- **`confirmed` but blocked by role/approver** — panels **hidden entirely**. No point advertising a capability the person will never have.

---

## 8. Commercial gating — recommendation

**Do not add a `ModuleKey`.** `MODULE_KEYS` is mirrored in the `org_modules_key_check` constraint (0088) and in `check-feature-catalog-parity.mjs`, and every existing key names a *product surface* (hazmatguard, dispatch, navigation, messages). Card control is not a separate product; it is what the EFS integration the customer already pays for does once EFS lets it. Gating on a module key means a customer with EFS wired up and write entitlement confirmed still gets a `module_disabled` 403 for an unrelated reason.

Gate on **capability** instead — the four ANDed facts in §6.4, all real and all diagnosable. If commercial gating is ever wanted, a `ModuleKey` becomes a fifth AND later: `efs_card_control_settings` already exists, `assertCardControlEnabled` is one function, and nothing about the write path changes. State this as a deliberate deferral in the migration comment so the next person does not read the omission as an oversight.

---

## 9. Sequencing

**Phase 0 — Transport** (no behaviour change). Extract `efsSoapSession.ts` with re-exports so no importer changes; add `withEfsSession`, session cache, single-flight login, shared breaker, extended error codes; add `timeoutMs` to both `soapFetch` branches and the `interactive` lane; env additions; re-pin/remove the `efsSoap.ts` filesize waiver. **Acceptance: existing feed tests pass untouched.**

**Phase A — Read.** `cardControlContract.ts` + `efsTime.ts` → `efsCardXml.ts` **and its fixture round-trip suite, written before any write code exists** → `efsCardOps.ts` (`getCardV2`, `getCardSummariesV2`, `getPolicy`, `searchLocation`) → migrations 0171 + 0173 → `efsCardMirror.ts` + the `efs_card_sync` job/handler/`KIND_CAPS`/scheduler → `routes/fuelCards/read.ts` → web routes, nav, `useEfsCards`, list page, detail page, `CardEffectiveConfig`.

**Ships independently.** A Cards page showing vendor truth is worth having even if writes never arrive.

### ★ THE GATE — the entitlement probe

Run on QA (`https://ws.partner.efsllc.com/axis2/services/CardManagementWS/`) against a card WEX confirms is disposable; only after QA passes, on production against a decommissioned card. It must prove **six** things, all of them:

1. `login` succeeds → credentials, TLS, routing.
2. `getCardSummariesV2` returns ≥1 card → **read entitlement**.
3. `getCardv2` parses; `parseCardDocument` produces a `WSCard` with no unmapped required field.
4. **`parse → serializeSetCardRequest(zero edits) → assertEchoFidelity` passes on real, production-shaped vendor XML.** Fixtures prove the parser against XML *we* wrote; this proves it against XML *WEX* wrote. **Needs no write permission — run it even if step 5 is expected to fail.**
5. `setCardV2` with the zero-edit echo returns success and not a permission fault → **write entitlement**. Record the exact success shape and tighten §5.5's classifier to match.
6. **A follow-up `getCardv2` returns the SAME `cardVersion`** → the no-op echo changed nothing.

Step 6 is the one that saves the company. `setCardV2` can succeed while our echo has silently stripped an `<infos>` record — the vendor will happily accept a well-formed request that deletes a driver assignment. **If the version moves after a no-op echo, the gate fails even though the write succeeded, and Phase B does not start.**

Outcomes: all six pass → `write_entitlement='confirmed'`, Phase B starts. Step 5 faults on permissions → `'denied'`; go to WEX naming `setCardV2` and `setCardRefreshingLimits` explicitly; Phase A stands alone meanwhile. Step 4 or 6 fails → `'unknown'`, recommendation `fix_echo`; add the offending response as a fixture, fix, re-probe. **Never proceed.** Archive the redacted probe response as an appendix in `docs/22-EFS-CARD-CONTROL.md`.

**Phase B — Write.** Migrations 0172, 0174 → `cardWriteLimits.ts`, `cardWriteLimit.ts`, `requireFreshAuth.ts` → `services/efsCardControl.ts` → `routes/fuelCards/control.ts` → web drawer, panels, location picker, history, settings page → roll out behind `EFS_CARD_CONTROL_ENABLED=false`, enable for one pilot org, watch the ledger for a week.

**Phase C — deferred (design accommodates, do not build).** Product-limit overrides (the p194 "echo *without* the limits array" recipe), `setCardRefreshingLimits` + the `…OVER` convention, bulk actions, maker-checker, mutation revert, `handEnter=DISALLOW`, location groups/blocklist.

---

## 10. Verification

### Unit — the round-trip suite is the centre of gravity

**`apps/api/src/lib/efsCardXml.test.ts`**, fixtures in `apps/api/src/lib/__fixtures__/efs/`:

| Fixture | Landmine |
|---|---|
| `getCardV2.full.xml` | ≥2 infos/limits/timeRestrictions, blocked locations, location groups |
| `getCardV2.single.xml` | **exactly one** `<infos>` — `elementToValue`'s 1-vs-N collapse |
| `getCardV2.empty.xml` | zero sub-objects |
| `getCardV2.nil.xml` | `<originalStatus xsi:nil="true"/>` |
| `getCardV2.unknownField.xml` | an undocumented `<futureFlag>` element |
| `getCardV2.namespaced.xml` | prefixed names (`ns2:infos`) |
| `getCardV2.autoRoll.xml` | v2 `autoRollMap`/`autoRollMax`, including `autoRollMax = 0` |

Per fixture: `parse → serialize(zero edits) → parse` yields an identical canonical multiset; the body contains **exactly as many** `<infos>` elements as the response (the single-record fixture fails if anyone routes the echo through `elementToValue`); `xsi:nil` survives with the attribute; `<futureFlag>` survives; `assertEchoFidelity` passes.

Per edit: `setStatus("Hold")` changes exactly one leaf; `replaceAll("infos", [])` removes all infos and fidelity **accepts** it because it was an explicit edit (empty-means-remove is tested behaviour, not hope); the p194 override recipes reproduce byte-for-byte. **Negative test: a deliberately corrupted serializer that drops `<limits>` makes `assertEchoFidelity` throw with the dropped path named** — without this the guard is decoration. `cardVersion`: whitespace/attribute-order differences hash the same, a `status` change differs, a `lastUsedDate` change hashes the **same**. `redactCardXml` leaves no 12+ digit run.

**`efsSoapSession.test.ts`** — 10 concurrent `withEfsSession` calls → exactly 1 login on the stub; one `InvalidClientId` → exactly one re-login then success; a second → throws with no third login; `AccountLockedException` opens the breaker and the next call throws **with zero network calls** (assert the stub's call count); expiry crosses 03:00 America/Chicago correctly under fake timers including a DST boundary; the login cookie rides every request; two orgs through one pooled agent carry different `Cookie` headers.

**`efsCardOps.test.ts`** — empty 200 = success, `Result -1` = `declined`, Fault → correct code; interactive timeout aborts; `getCardSummariesV2` maps `A|H|U|I`.

**`soapClient.test.ts`** (extend) — `timeoutMs` aborts on both branches; `soapLaneRps("interactive")` does not disturb the live/backfill split (existing assertions stay green unmodified).

### Service — `supabaseRecorder` + `expectOrgScoped`

**`efsCardControl.test.ts`** — happy path writes `pending` then `succeeded`; an `expectedVersion` mismatch throws **before any `setCardV2`** (asserted on the stub's call log, not just the thrown error); a fault → `failed` + fault code + mirror updated from the re-read; a re-read failure → `sent` + `card.mutation_unverified`; drift → `drift_detected` with `drift` populated; `expectOrgScoped(rec, ORG)` across the whole run.

**`efsCardMirror.test.ts`** — upserts on `(org_id, card_ref_hmac)`; **scans every recorded write payload for a 12+ digit run and fails if one is found** (mechanical proof no plaintext PAN reaches the DB); links via `cardIdentityKey`/`cardRefsMatch`, ambiguous → null + `sync_error`; never writes `fuel_cards`; `SECRETS_ENCRYPTION_KEY` unset → refuses to write.

### Route — house style (real app on port 0, injected `verifyToken`, token string = persona, no Supabase mocks)

`apps/api/src/routes/fuelCards.test.ts`. Personas: admin, fleet_manager, dispatcher, safety_manager, auditor, driver, other_org. Reads pass for the five viewing roles (`expect([401,403]).not.toContain(res.status)`), 403 for driver. Writes 403 for dispatcher/safety_manager/auditor/driver. 403 `card_control_disabled` with the kill switch off; 403 `card_control_not_entitled`; 403 for a manager not on the approver list. 409 `card_state_changed` carrying `currentVersion`. 200 `{idempotent:true}` on replay, 409 `mutation_in_flight` in flight. 429 + `Retry-After`. **Cross-org `:id` → 404, not 403.** `prompts` without `replaceAll:true` → 400; removing DRID without the flag → 400.

`routeAuth.test.ts` discovers `/api/fuel-cards` from `app.ts` source with no edit and fails CI if either router forgets `requireAuth`.

### Web

`cardControlModel.test.ts` (availability matrix, prompts diff, confirmation copy) · `CardControlDrawer.test.ts` (confirmation replaces rather than stacks, footer swaps, `busy` disables both buttons, primary disabled until a reason is entered, 409 surfaces the bespoke toast) · `EfsLocationPicker.test.ts` (no query below two chars; selecting emits the 6-digit id) · `CardEffectiveConfig.test.ts` (card record suppresses the matching policy record; `infoSource: CARD` greys policy rows; gallons for `ULSD`, dollars for `MERC`) · `nav.test.ts` extended · `apps/web/e2e/fuel-cards.spec.ts` — **read-only, no e2e ever mutates EFS**.

### Manual QA

Point a staging org at the QA endpoint → `test-connection` → set `EFS_CARD_CONTROL_PROBE_ENABLED=true` **on staging only** → run the probe with the WEX-confirmed disposable card → read all six step results → archive redacted into `docs/22-EFS-CARD-CONTROL.md` → unset the flag → repeat once on production with a decommissioned card → set `write_entitlement`.

### Fitness gates that will bite

`lint:filesize` (500, `efsSoap.ts` pinned at 519 — the extraction is the entry ticket; re-pin after) · `lint:funcsize` (200 — `applyCardMutation` and the drawer's confirm handler are the risks) · `check-rls.mjs` (all four tables need `enable row level security` + a 0106-style "service-role only, and why" comment) · `lint:migrations` · `lint:tests` · `check-design-tokens.mjs` (no raw palette utilities, no hex, badges only via `@/lib/badges.ts`) · `check-feature-boundaries.mjs` (hence the `maskPan` move) · `lint:secrets` (fixtures use an obviously fake card number) · `routeAuth.test.ts` · `check-feature-catalog-parity.mjs` **not triggered** — no `ModuleKey` added, deliberately.

---

## 11. Risks and non-goals

### Explicit non-goals for Phase 1

Write these into the docblock of `routes/fuelCards/control.ts` so nobody adds them casually:

- **No `removeCard`** — hard delete in the EFS system (p128). Never exposed, not now, not later. `Inactive`/`Hold` is always the answer.
- **No `setCardPin`** — a driver-held secret; the handoff is a whole feature.
- **No card ordering** (`createOrder`, `createAndSubmitOrder`, `replaceLostOrStolenCard`, `reissueDamagedCard`, `transferCard`) — costs money per card, involves shipping addresses.
- **No `managedFuelAction`** — needs `fuel_plans` integration and an "exactly one card per Driver ID" precondition we cannot assert.
- **No `setPolicy`** — fleet-wide blast radius by construction.
- **No product-limit overrides** — the one p194 recipe that requires *deliberately* dropping an array, the exact shape of the disaster we are guarding against. Phase C, with its own confirmation and step-up.
- **No `setCardRefreshingLimits` / `…OVER` convention. No bulk actions. No location-group or blocklist editing. No `handEnter=DISALLOW`** (worth doing — it kills a whole skimming class — but needs station-compatibility verification with WEX first).

### Risks

1. **A bad echo strips driver assignments across the fleet.** Highest severity by a wide margin — EFS will accept a well-formed `setCardV2` that deletes an `<infos>` record. Depth of mitigation: raw-DOM echo → `assertEchoFidelity` refusing to send, in production → the gate's no-op-echo + version-stability step against real vendor XML → single-card-only endpoints → before/after documents on every ledger row. Recovery: `before_document` makes a revert replayable; the columns exist now, build `POST /mutations/:id/revert` in Phase C.
2. **Locking the shared service account**, taking transaction ingestion with it. §6.8; the shared breaker is the key control. Sentry alert + settings-page banner on breaker-open.
3. **PAN exposure.** §6.5. Residual: the PAN exists in transit and in Node memory in every `getCardv2` response and, worse, for the entire fleet in one `getCardSummariesV2` response. The digit-run scan in `efsCardMirror.test.ts` is the mechanical proof.
4. **Mirror drift** — anyone can change a card in the WEX portal. `synced_at` + staleness banner past 60 minutes; a **mandatory fresh `getCardv2` inside every mutation** so the mirror is never the basis for a write; the nightly sweep; `card.drift_detected`. **Do not auto-correct the other way** — EFS wins, the mirror updates, the audit records that it moved without us.
5. **Interactive latency vs vendor pacing** — mitigated by the dedicated lane. Raise `EFS_SOAP_MAX_RPS` only after confirming the real limit with WEX; the guide warns excessive polling can trigger account suspension.
6. **Status vocabulary mismatch** — `fuel_cards.status` is free text used by attribution; `efs_cards.status` is the EFS enum. **Do not unify in Phase 1.** `Fraud` is in the check constraint; an unrecognised value renders verbatim rather than being dropped.
7. **Timezone** — all EFS servers are Central. One helper (`efsTime.ts`), tested across a DST boundary. Getting this wrong shows a fill an hour off and quietly undermines trust in the whole page.
8. **A `setCardV2` timeout is not a failure.** `retry: false` is load-bearing; the `sent` terminal-unknown state exists for when even the re-read fails.
9. **`getPolicy` caching** — a stale cache shows the wrong effective limits. 15 minutes, invalidated on `card.prompts_changed`, stamped with its own fetch time.

---

## Critical files

**Modify:** `apps/api/src/lib/efsSoap.ts` (extract; re-pin waiver) · `apps/api/src/lib/soapClient.ts` (`timeoutMs`, `interactive` lane) · `apps/api/src/app.ts` (mounts, `strictLimiter`) · `apps/api/src/env.ts` · `apps/api/src/routes/integrations.ts` (probe endpoint) · `apps/api/src/services/jobs.ts` + `queue/handlers/index.ts` + `worker.ts` (`efs_card_sync`) · `apps/api/src/lib/sentryScrub.ts` · `packages/shared/src/index.ts`, `cardAssignment.ts` (`maskPan`) · `packages/ui/src/icons.ts` · `apps/web/src/router/index.ts`, `lib/nav.ts`, `pages/SettingsPage.vue`, `features/fueling/useCardAssignments.ts` · `scripts/check-file-size.mjs` · `docs/22-EFS-CARD-CONTROL.md` (probe appendix).

**Create:** `apps/api/src/lib/{efsSoapSession,efsCardXml,efsCardOps}.ts` · `apps/api/src/services/{efsCardControl,efsCardMirror}.ts` · `apps/api/src/middleware/{cardWriteLimit,requireFreshAuth}.ts` · `apps/api/src/routes/fuelCards/{read,control}.ts` · `packages/shared/src/{cardControlContract,efsTime,cardWriteLimits}.ts` · `supabase/migrations/017{1,2,3,4}_*.sql` · `apps/web/src/pages/{FuelCardsPage,FuelCardDetailPage,CardControlSettingsPage}.vue` · `apps/web/src/features/fuelCards/*` · fixtures and tests named in §10.

**Reference (do not modify):** `apps/web/src/features/roster/DriverAccessModal.vue` (the drawer to copy) · `supabase/migrations/0106_efs_soap_client_certs.sql` and `0152_dq_exports.sql` (migration voice) · `apps/api/src/routes/roster/drivers.ts` (route + audit-values pattern) · `apps/api/src/testing/supabaseRecorder.ts`.
