# FleetPal vendor material — what is in this directory, and what was read from it

**This file is the only tracked thing here.** Everything else in `docs/FleetPal/` is gitignored:
the vendor's document is not ours to redistribute, and the OpenAPI JSON is 830 KB of generated
output that would land in a diff nobody can review. See the `.gitignore` block for the pattern —
it is `docs/FleetPal/*` and not `docs/FleetPal/`, for a reason stated there.

So the working tree holds the spec and history holds this note. The note exists because a later
reader's copy of the spec may be **newer** than the one the contracts were built from, and without
a recorded version they would assume the two agree.

## What was read

| | |
|---|---|
| File | `docs/FleetPal/Fleetpal API.json` |
| Retrieved | before 2026-09-09, by the owner, from the vendor |
| Read in full | **2026-09-10** (an earlier partial read on 2026-09-09 produced INVENTORY-PLAN §8's audit) |
| `info.title` / `info.version` | `Fleetpal API` / `v1` |
| Server | `https://openapi.fleetpal.io` |
| Size | 829,920 bytes |
| Endpoints | 71 paths (35 list collections plus their `{id}` members, and `/status`) |
| Contact | `support@fleetpal.io` |

The spec carries no build or revision stamp beyond `info.version: v1`, which the vendor holds
constant while adding endpoints and optional fields — so **`v1` does not identify a snapshot**.
Byte size and the endpoint count above are the only fingerprints available. If either differs from
what your working tree holds, the document has moved and
`packages/shared/src/fleetpal/fieldManifest.generated.json` should be regenerated (step F1).

## What was built from it

- `docs/plans/maintenance/FLEETPAL-INTEGRATION-PLAN.md` — the plan. §1.5 holds the complete filter
  matrix; §2.10 holds the seven things the spec proves FleetPal cannot supply.
- `packages/shared/src/fleetpalContract.ts` and its generated field manifest (step F1) — the
  manifest is what lets `lint:fleetpal-contract` run in CI, where this directory does not exist.

## Two conventions from the spec that are easy to get wrong

- **Money** is a JSON number in currency units with up to three decimals — `125.5` is $125.50. Not
  cents, not a string. Parse to a decimal type, never a binary float.
- **Distances** on meter readings are canonical **metres**, never the company's display units.
  Divide by 1609.344 for miles.

## ⚠ 2026-11-18 — this copy is 100 endpoints behind the vendor

FleetPal serves its current document at **`GET https://openapi.fleetpal.io/v1/openapi.json`** (with the
API key). Read 2026-11-18: **174 paths, 961,701 bytes** — against the 71 paths above. Among the
differences, `POInvoice.attachments` (the shop's scanned bill, pre-signed link, 1 h) — which this copy
lacks, and which is why Q-IC12 and D-FP27 were ruled believing FleetPal serves no files. F16 reads it
(FLEETPAL-INTEGRATION-PLAN D-FP28) through a schema the gate does not yet map. Replacing this file and
regenerating the manifest surfaces 28 unmodelled fields: plan Q13 / F16b. Until then, **check the live
document before concluding FleetPal cannot do something.**
