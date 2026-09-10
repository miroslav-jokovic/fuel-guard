/**
 * FleetPal — the maintenance collector's wire contracts (FLEETPAL-INTEGRATION-PLAN.md step F1).
 *
 * The vendor's API is documented at `openapi.fleetpal.io/v1`; the document itself lives in
 * `docs/FleetPal/` and is **gitignored** — it is not ours to redistribute, and 830 KB of generated
 * JSON would land in a diff nobody could review. `docs/FleetPal/SOURCE.md` records which version
 * these schemas were built from, and that matters: `info.version: v1` is held constant by the
 * vendor across additive changes and identifies no snapshot.
 *
 * ── WHY THIS IS SPLIT ACROSS FOUR FILES ──────────────────────────────────────────────────────
 * Not the 500-line budget alone — the seam is the vendor's own. `primitives` holds the four wire
 * conventions everything depends on; `equipment` is the unit and what is wrong with it;
 * `repair` is the work order and what it cost; `purchasing` is the catalogue and the paperwork.
 * A reader looking for "why is the odometer 663 million" finds it in one place.
 *
 * ── WHAT A CONTRACT HERE PROMISES, AND WHAT IT DOES NOT ──────────────────────────────────────
 * It promises the shape we depend on is present and typed. It does **not** promise the vendor sends
 * nothing else: every object is `z.looseObject`, every vocabulary is `z.string()` with a separate
 * `const` of known members, and both choices exist because the vendor reserves the right to add
 * response fields and enum members inside v1 while instructing consumers to ignore what they do not
 * recognise. A strict contract would turn an allowed change into an outage.
 *
 * The gap that leaves — a parser that accepts a value nothing has been written to handle — is
 * closed by `lint:fleetpal-contract`, which compares these schemas against
 * `fleetpal/fieldManifest.generated.json`, a field-name-only artefact derived from the spec.
 * That indirection is not ceremony: the spec is absent in CI by design, so a gate reading it
 * directly would SKIP on every CI run while appearing to pass — the failure mode `lint:wsdl` spent
 * ten days in.
 *
 * ── ⚠ NO VENDOR PROSE, AND NO VMRS TEXT, IS STORED ANYWHERE IN THIS TREE ─────────────────────
 * VMRS component, complaint, reason-for-repair and manufacturer arrive as ids that resolve to a
 * code and an English description. The code is a fact about a repair we performed and is ours to
 * keep; the description is licensed TMC material whose distribution tier is a recurring fee we
 * chose not to pay (D-FP8, ruled by the owner 2026-09-10). Descriptions are fetched at display
 * time and dropped. Nothing here has a description column, and no schema in this directory carries
 * one.
 */

export * from "./fleetpal/primitives.js";
export * from "./fleetpal/equipment.js";
export * from "./fleetpal/repair.js";
export * from "./fleetpal/purchasing.js";
