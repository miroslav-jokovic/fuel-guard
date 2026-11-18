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
| Retrieved | **2026-11-18**, from `GET https://openapi.fleetpal.io/v1/openapi.json` with the API key (the vendor serves its current document there). Previously: before 2026-09-09, by the owner. |
| Read in full | **2026-11-18** for Q13 (the 2026-09 copy was read in full on 2026-09-10) |
| `info.title` / `info.version` | `Fleetpal API` / `v1` |
| Server | `https://openapi.fleetpal.io` |
| Size | **961,701 bytes** (was 829,920) |
| Endpoints | **174 paths**, no trailing slashes (was 71, with them) |
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

## 2026-11-18 — refreshed (plan Q13)

The September copy was 100 endpoints behind; that is why Q-IC12 and D-FP27 were ruled believing FleetPal
serves no files while `POInvoice.attachments` carried a scanned bill on ~95% of invoices. Regenerating
the manifest surfaced 28 fields the contracts did not model; all 28 are now modelled as optional and
none is stored. **To refresh again:** fetch the URL above into this file, run
`node scripts/gen-fleetpal-manifest.mjs`, then `pnpm lint:fleetpal-contract` lists what to model. Do it
before concluding FleetPal cannot do something.
