# Devin — EFS QA environment setup

Repo: FuelGuard. Branch: `main`. Nothing needs to be pushed — commit `4c5151f` is already
deployed and live (`GET https://fleetguardapi-production.up.railway.app/api/version` returns
`commit: 4c5151f…`, `schema.applied: 0178`, `drift: false`).

WEX has created a QA/test EFS account for us with 13 disposable cards. The purpose of this task is
to prepare everything around it so a human can run the write probe safely. **You are not running
the write probe, and you are not turning card writes on.**

---

## Hard rules — read these before doing anything

1. **Do NOT set `EFS_CARD_CONTROL_ENABLED`.** Not to `true`, not to `false`, not at all. It is the
   deploy-wide kill switch for real card writes and it stays unset until a human has read a passing
   six-proof write check. If you find it already set, stop and report it.

2. **Do NOT handle the WEX QA username or password.** Miki enters those himself through the app UI,
   which seals the password at rest. Do not ask for them, do not put them in a Railway variable, do
   not put them in SQL, do not put them in a file.

3. **Do NOT touch the existing `efs_soap_credentials` row for the production org**
   (`86d6b3ea-4361-4f71-877f-e8373615769b`). `upsertEfsSoapCredentials` is an upsert on `org_id`;
   overwriting that row breaks the live card sync for 199 real cards.

4. **Do NOT call `POST /api/fuel-cards/write-check`.** That endpoint can send a real `setCardV2`.
   A human runs it, with a fresh sign-in and a typed confirmation string.

5. Work in your own clone. Do not touch Miki's checkout at `~/Projects/FuelGuard`.

If any step's actual result differs from what is written here, **stop and report** rather than
improvising. Every number below was read out of the running system, not guessed.

---

## Step 1 — Confirm what is deployed

```bash
curl -s "https://fleetguardapi-production.up.railway.app/api/version?cb=$(date +%s)" | jq .
```

Expected: `commitShort` `4c5151f`, `branch` `main`, `schema.applied` `0178`, `ok` `true`.

If `commitShort` differs, the deploy moved since this was written — report the value and stop.

---

## Step 2 — Railway variables

Link the CLI to the project and the **API** service (not the web service):

```bash
railway login
railway link
railway status          # confirm project + environment + service before changing anything
railway variables       # print current values
```

Check the CLI's own syntax first — it has changed between versions:

```bash
railway variables --help
```

Then, on the **API service only**:

| Variable | Required value | Why |
|---|---|---|
| `EFS_SOAP_ENABLED` | `true` | Master EFS kill switch. `getEfsSoapCredentials` returns `enabled: row.enabled && env.EFS_SOAP_ENABLED`, so with this false **nothing dials EFS at all** — not QA, not production, and the card mirror never refreshes. A recent variable dump showed it as `false`; confirm and fix. |
| `EFS_CARD_CONTROL_PROBE_ENABLED` | `true` | Gates the read-only write check. Miki reports this is already set — verify rather than assume. |
| `EFS_CARD_CONTROL_ENABLED` | **must remain unset** | See hard rule 1. Verify it is absent. Do not create it. |

Report the before/after value of each of the three. Do not change any other variable. In particular
`ALLOWED_ORIGINS` is comma-separated and must be appended to, never replaced — but nothing in this
task needs it changed.

A variable change redeploys the API. Wait for it, then re-run Step 1 and confirm `ok: true`.

---

## Step 3 — Create the QA organization

The QA EFS credentials must live on their **own org**. `efs_soap_credentials` is one row per org and
the endpoint URL travels with it, so a separate org is what keeps the QA endpoint away from the 199
production cards. This is safe: the SOAP session cache, the login breaker, the rate-limit slot and
the location-shape cache are all keyed `orgId:endpointUrl`, so nothing QA does can consume the
production request budget or trip the production breaker.

### 3a — The login must be a NEW user

`supabase/migrations/0006_auth_hook.sql` stamps `org_id` into the JWT from the user's **earliest**
membership:

```sql
select m.org_id, m.role::text from public.memberships m
where m.user_id = (event->>'user_id')::uuid
order by m.created_at asc limit 1;
```

So adding Miki's existing account to a second org does nothing — his production membership is older
and still wins. The QA org needs a separate auth user whose **only** membership is the QA org.

**Miki does this part**: sign up `uncchicago85+efsqa@gmail.com` through the normal signup flow and
confirm the email. Tell him when you are ready for it; do not create auth users yourself.

### 3b — Create the org and the membership

Once that user exists, run against the Supabase database:

```sql
-- 1. Verify the user exists and has NO membership yet. Must return zero rows.
select u.id, u.email, m.org_id, m.role
from auth.users u
left join memberships m on m.user_id = u.id
where u.email = 'uncchicago85+efsqa@gmail.com';

-- 2. Create the org and make that user its admin. Idempotent: re-running is a no-op.
with u as (
  select id from auth.users where email = 'uncchicago85+efsqa@gmail.com'
), o as (
  insert into organizations (name)
  select 'FuelGuard EFS QA'
  where not exists (select 1 from organizations where name = 'FuelGuard EFS QA')
  returning id
), org as (
  select id from o
  union all
  select id from organizations where name = 'FuelGuard EFS QA'
  limit 1
)
insert into memberships (org_id, user_id, role)
select org.id, u.id, 'admin' from org, u
on conflict (org_id, user_id) do update set role = 'admin';

-- 3. MUST return exactly one row: FuelGuard EFS QA / admin.
--    More than one row means the auth hook will hand this user the wrong org.
select o.id as org_id, o.name, m.role
from memberships m
join organizations o on o.id = m.org_id
join auth.users u on u.id = m.user_id
where u.email = 'uncchicago85+efsqa@gmail.com';
```

Report the QA `org_id` from query 3. **Stop if query 3 returns anything other than exactly one row.**

---

## Step 4 — Hand back to Miki for the credentials

Tell Miki:

> Sign in as `uncchicago85+efsqa@gmail.com`, go to Settings → EFS Integration, and enter:
>
> - Endpoint: `https://ws.partner.efsllc.com/axis2/services/CardManagementWS`
>   (no `?wsdl` — that is the WSDL document URL, not the SOAP endpoint)
> - Environment: `sandbox`
> - Username / password: the WEX QA credentials
>
> These go through the UI so the password is sealed. Do not paste them into any chat or file.

Then verify from the database that the row landed and points where it should — **never select
`soap_password`**:

```sql
select org_id, environment, endpoint_url, account_id, enabled, updated_at
from efs_soap_credentials
order by updated_at desc;
```

Expected: two rows. The production org still on its original endpoint with `environment` unchanged,
and the new QA org on `…/axis2/services/CardManagementWS` with `environment = 'sandbox'` and
`enabled = true`. If the production row's `endpoint_url` or `updated_at` changed, something went to
the wrong org — stop and report.

---

## Step 5 — Re-sync the production card mirror

Separate from QA, and needed because of the bug fixed in commit `3492c50`.

The card detail page reads `efs_cards.document`, a stored jsonb. Every one of those documents was
written by the old parser, which could not see the nested `<header>` shape and therefore recorded
`infos: []` on every card. That is why the prompts panel shows only the policy-level Odometer entry.
The fix is deployed, but the stored rows do not heal on their own — the detail pass has to re-run.

**Miki does this**: press Refresh on the Cards page (`POST /api/fuel-cards/sync`). It queues an
`efs_card_sync` job. `EFS_CARD_SYNC_MAX_DETAIL` defaults to 200 and there are 199 cards, so one run
covers the fleet.

**You verify it worked**, after the job finishes:

```sql
select
  count(*)                                                          as total,
  count(*) filter (where jsonb_array_length(document->'infos') > 0)  as with_prompts,
  count(*) filter (where jsonb_array_length(document->'infos') = 0)  as no_prompts,
  max(synced_at)                                                    as last_sync
from efs_cards
where org_id = '86d6b3ea-4361-4f71-877f-e8373615769b';
```

Before the re-sync `with_prompts` will be 0. After it, the great majority of the 199 should have
prompts. A handful of genuinely unassigned cards legitimately have none — that is fine. If
`with_prompts` is still 0 after the job completes, **stop and report**, because it means the deployed
parser is still not seeing the sub-objects.

Also check the job actually ran rather than skipping:

```sql
select kind, status, stats, last_error, created_at, updated_at
from jobs
where kind = 'efs_card_sync'
order by created_at desc
limit 5;
```

`status = 'skipped'` with reason `efs_soap_disabled` means Step 2 did not take effect.

---

## Step 6 — Report, then stop

Post back:

1. `/api/version` output (Step 1).
2. Before/after for the three Railway variables, and explicit confirmation that
   `EFS_CARD_CONTROL_ENABLED` is **not set**.
3. The QA `org_id` and the single-row result of Step 3 query 3.
4. The `efs_soap_credentials` listing from Step 4, minus the password column.
5. The `efs_cards` counts and the `jobs` rows from Step 5.

Then stop. The next two steps are a human's:

- `POST /api/fuel-cards/diagnose` as the QA admin against one of the 13 QA cards — proves login,
  read entitlement, and prints our egress IP so the three allowlisted addresses can be confirmed.
- `POST /api/fuel-cards/write-check` with `readOnly: true` — proves the echo against XML WEX wrote,
  and reports which response shape the QA account returns. Both require a sign-in within the last
  five minutes (`requireFreshAuth`).

The QA cards, for reference — all 13 are disposable per WEX:

```
7083050030631547671  7083050030631557670  7083050030631567679  7083050030631577678
7083050030631597676  7083050030631507675  7083050030632517673  7083050030632527672
7083050030632547670  7083050030632557679  7083050030632567678  7083050030632577677
7083050030632597675
```
