# Devin — get EFS Card Control Phase B onto `main` and the schema onto production

Repo: `https://github.com/miroslav-jokovic/fuel-guard`. Branch: `feat/efs-card-control-phase-b`,
4 commits, 45 files, ahead of `main`. **Clone your own copy — do not work in Miki's checkout at
`~/Projects/FuelGuard`.**

Everything is already written and tested. Your job is delivery: PR → CI → `main` → migrations →
verify. You are not being asked to change any code.

## Step 0 — is the branch on origin?

```bash
git ls-remote --heads origin feat/efs-card-control-phase-b
```

Empty output means Miki has not pushed yet and there is nothing you can do — the branch exists only
on his machine. Say so and stop. Do not recreate the work.

## Step 1 — PR and CI

Open a PR from `feat/efs-card-control-phase-b` into `main`. Title:
`EFS Card Control Phase B — the write path, gated off`.

Wait for `ci.yml` to conclude green on the PR head. Do not merge on a red or pending run: `migrate.yml`
polls for CI on the exact head SHA and fails closed, so a red merge leaves the schema behind the code.

## Step 2 — merge

Merge with a **merge commit** (`Merge EFS card control Phase B`), matching this repo's history. Do not
squash — the four commits carry the reasoning for four separable concerns.

## Step 3 — watch the migrations

Merging fires `migrate.yml` (push to `main` touching `supabase/migrations/**`, gated on CI green). It
runs `supabase db push`, which will apply **three** files:

| File | Note |
|---|---|
| `0176_efs_cards_tolerant_vendor_values.sql` | ⚠ In the repo but NOT in the ledger — it was applied by hand in the SQL editor on 2026-08-11 after a version collision (docs/22 §4). `db push` will run it for the first time. It is idempotent by construction: its `do $$` block drops every check constraint on the columns it re-adds. |
| `0177_efs_card_mutations.sql` | The mutation ledger. |
| `0178_card_write_counters.sql` | Write counters + `bump_card_write_counter` RPC. |

If `0176` errors, **stop and report**. Do not renumber it, do not skip it, do not edit it. A renumber
burns another version string in the ledger, which is the exact failure this migration already caused
once.

## Step 4 — verify, and say the numbers

```bash
curl -s https://fleetguardapi-production.up.railway.app/api/version | jq .
curl -s https://fleetguardweb-production.up.railway.app/api/version | jq .
```

Both must report the merge commit and:

```json
"schema": { "expected": "0178", "applied": "0178", "state": "current", "drift": false }
```

`applied` below `0178` means `db push` did not do what the workflow log claims. Report the actual JSON
rather than a summary of it.

## Step 5 — confirm writes are still OFF

This is the point of the whole exercise. Phase B ships **switched off**, behind four ANDed facts.

- **Do not set `EFS_CARD_CONTROL_ENABLED` anywhere.** It defaults false and stays false.
- **Do not run the write probe** (`POST /api/fuel-cards/write-check`). It sends a real `setCardV2` to a
  real card and belongs to Miki, on staging, against a card WEX has confirmed is disposable.
- **Do not set `EFS_CARD_CONTROL_PROBE_ENABLED`.**

Prove it with a signed-in admin token:

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"expectedVersion":"0123456789abcdef0123456789abcdef","reason":"deploy check"}' \
  https://fleetguardapi-production.up.railway.app/api/fuel-cards/<any-card-uuid>/lock
```

Expected: `403` with `"code": "card_control_disabled"`. Anything else — especially a `200` — is an
incident: report it immediately and do not retry.

Reads must be unaffected: `GET /api/fuel-cards` still returns the 199-card mirror.

## Done looks like

Merge commit on `main`, CI green, `applied: "0178"`, `drift: false` on both services, a `403
card_control_disabled` on the lock route, and the card list still loading. Report all five.
