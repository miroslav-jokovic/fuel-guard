# Devin — open the last gate on card actions, and gather evidence on a slow page

Repo: FuelGuard, branch `main`. Nothing to push — `40b06a1` is deployed and live.

Three of the four gates on EFS card control are already satisfied for the QA org
(`07fe4058-cc72-4a69-b3e9-29b4cf1c6a44`). The fourth is a Railway variable on the API service, and
it is the only change this task makes. Everything else here is verification and evidence-gathering.

---

## Hard rules

1. **Change exactly one variable: `EFS_CARD_CONTROL_ENABLED`, on the API service, to the literal
   string `true`.** Nothing else. In particular `ALLOWED_ORIGINS` is comma-separated and must never
   be replaced.
2. **Do NOT call `POST /api/fuel-cards/write-check`.** It can send a real `setCardV2`. A human runs
   that, with a fresh sign-in and a typed confirmation.
3. **Do NOT insert, update or delete any row** in `efs_card_control_settings`,
   `efs_card_control_approvers` or `efs_soap_credentials`. Read them only.
4. **Stop and report** if Step 1 does not return exactly what it says it should. That check is what
   makes Step 2 safe.
5. Work in your own clone; do not touch Miroslav's checkout.

---

## Step 1 — Prove the production org is still blocked (BEFORE touching anything)

`EFS_CARD_CONTROL_ENABLED` is deploy-wide: it applies to every org on the API. Production
(`86d6b3ea-4361-4f71-877f-e8373615769b`, 199 real cards) is held shut by two *other* facts, and this
step confirms both are still true.

```sql
select org_id, enabled, write_entitlement, require_approver
from efs_card_control_settings;
```

**Expected: exactly one row**, the QA org, `enabled = true`, `write_entitlement = confirmed`.

The production org must have **no row at all**. In `loadCardControlAccess` a missing row means
`row?.enabled` is undefined → `not_enabled`, and `write_entitlement` defaults to `unknown` →
`not_entitled`. Two independent blocks.

**If a row exists for `86d6b3ea-…` — stop. Do not set the variable. Report what you found.**

---

## Step 2 — The variable

```bash
railway login
railway link
railway status            # confirm project + environment + the API service, not the web service
railway variables         # print current values
railway variables --help  # CLI syntax has changed between versions; check before setting
```

On the **API service only**:

| Variable | Set to | Notes |
|---|---|---|
| `EFS_CARD_CONTROL_ENABLED` | `true` | The literal word. See the parser note below. |

The parser is `z.string().default("false").transform((s) => s.toLowerCase() === "true")`. So `true`,
`True` and `TRUE` all work, but **`1`, `yes` and `on` silently evaluate to false** and the feature
stays shut with no error anywhere. If the variable is already present, report its exact current
value before changing it — "it was set to `1`" is a finding worth having.

Report the before and after value. Confirm you did not touch any other variable.

---

## Step 3 — Confirm the deploy

Setting a variable redeploys the API. Wait for it, then:

```bash
curl -s "https://fleetguardapi-production.up.railway.app/api/version?cb=$(date +%s)" | jq .
```

Expected: `commitShort` `40b06a1`, `schema.applied` `0178`, `ok` `true`, and a **`startedAt` later
than `2026-08-11T23:53:00Z`** — that timestamp is how you know the new value is actually in the
running process rather than only in the dashboard.

---

## Step 4 — Re-confirm the other three gates are intact

Read-only. These should be unchanged by anything above; the point is to have all four facts recorded
in one place at one moment.

```sql
-- gate 2: this org has a working EFS connection. Never select soap_password.
select org_id, environment, endpoint_url, enabled, updated_at
from efs_soap_credentials order by updated_at desc;

-- gate 3 + 4: repeat of Step 1, after the redeploy
select org_id, enabled, write_entitlement, require_approver
from efs_card_control_settings;

-- the approver grant the role gate needs on top of the four
select a.org_id, u.email, a.scopes
from efs_card_control_approvers a
join auth.users u on u.id = a.user_id;
```

Expected: two credential rows (production on `ws.efsllc.com`, QA on
`ws.partner.efsllc.com/axis2/services/CardManagementWS/`, environment `sandbox`); one settings row;
one approver row for `uncchicago85+efsqa@gmail.com` with all four scopes.

---

## Step 5 — Evidence for a slow page (do not fix anything)

The card detail page takes 15–20 seconds to load. `apps/api/src/routes/fuelCards/read.ts:285` makes a
live SOAP call to EFS on every load:

```ts
if (creds?.enabled) policy = await getPolicy(env, creds, row.policy_number);
```

There is no cache. The hypothesis is that the time is going into the interactive rate limiter (1
req/sec), a session login, and — if `getPolicy` returns HTTP 5xx — four retries with 250ms→4s
backoff, which is an 8–9 second signature we have measured before on refused calls.

**Confirm or kill it from the logs.** Ask Miroslav to open a QA card detail page, note the time, then:

```bash
railway logs --help          # check flags for service + since/tail
railway logs                 # API service
```

Look for, around that timestamp:

- `[efs-cards]` lines
- anything containing `Not Allowed`, `getPolicy`, `retry`, or a 5xx status
- how long elapses between the request arriving and the response

Report the raw lines. **Do not change any code** — the fix (caching `getPolicy` per org+policy, and
not retrying a permanent refusal) is a separate reviewed change.

---

## Step 6 — Report

1. Step 1 output, and explicit confirmation that the production org had no settings row.
2. `EFS_CARD_CONTROL_ENABLED` before → after, and confirmation no other variable changed.
3. `/api/version` output including `startedAt`.
4. The three Step 4 query results.
5. The Step 5 log excerpt, or "no relevant lines found".

Then stop. The next action is Miroslav's: open a QA card, confirm Lock / Exception / Prompts appear
where it currently says "Card actions are paused", lock and unlock card `7671`, and check that
`efs_card_mutations` has two rows with sensible before/after documents.
