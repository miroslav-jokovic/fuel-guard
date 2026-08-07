# Placard calculator — scope findings (2026-08-07)

Raised by the product owner: the calculator looks built for tankers and fuel, the plan was Table 2,
and it does not use the trailers the fleet already has. Audited against the code, the shipped dataset
and the plan.

## 1. One correction first

**Fuel is on Table 2.** Class 3 (`FLAMMABLE`) and `Combustible liquid` (`COMBUSTIBLE`) are both Table 2
rows in the shipped dataset — gasoline UN1203 is Class 3 PG II, diesel UN1202 is Class 3 PG III. They
are not a separate thing from Table 2; they are two of its fifteen rows.

So the scope is not wrong. **D4 (revised 2026-07-24)** already says *"Launch scope: Table 2 materials
only"*, and `computePlacards` implements exactly that: Table 2 computed, Table 1 recognised and
fail-closed with `table1_out_of_scope_v1`. The dataset carries all 23 rows with a parser that refuses
to ship if the two tables are swapped.

What is wrong is everything around it. The engine is a Table 2 engine wearing a fuel-tanker costume,
and in three places the costume has become the behaviour.

## 2. F-P1 — Class 6.1 and 5.2 are unreachable. **534 of 2,479 HMT entries.**

The worst finding, and it is not a UI problem.

Table 1 and Table 2 both contain a 6.1 row, distinguished only by prose inside the class string:
`"6.1 (material poisonous by inhalation …)"` versus `"6.1 (other than material poisonous by
inhalation)"`. `baseClass()` (`compute.ts:65-68`) strips exactly that qualifier with
`/^\s*(\d+(?:\.\d+)?)/`, so both collapse to the key `6.1`. `compute.ts:120` then finds
`matches.length === 2` and returns:

> `Class "6.1" (key "6.1") maps to 2 placard rows — outside the fuel scope`

**Every Class 6.1 material in the Hazardous Materials Table — the single largest class, 534 entries —
returns a withheld determination.** Class 5.2 (21 entries) does the same. D4 lists "non-PIH 6.1" as
*in* scope. It has never once worked.

### F-P1 — **FIXED 2026-08-07**

`packages/hazmat-engine/src/placards/tableSelect.ts` decides the qualifier from the entry rather than
giving up on the class number.

- **6.1** — §172.102(c)(1) special provisions. Codes **1–4 assert** poison-by-inhalation (Hazard Zones
  A–D; 1 and 2 cite §173.133(a), the Division 6.1 rule) → Table 1. Code **5 asserts nothing**: it reads
  *"**If** this material meets the definition … a shipping name must be selected which identifies the
  inhalation hazard"* — the answer lives on the shipping paper, not in the table. So code 5 alone is
  **undeterminable**, not "no". Reading it as "no" would under-placard a PIH material, which is the one
  error the engine exists to prevent. The proper shipping name is used as a second signal, and it can
  only ever push a material *toward* Table 1 — the safe direction.
- **5.2** — the Table 1 row is Type B *and* temperature controlled, and the shipping names say so
  literally. Both conditions required; Type B without temperature control is Table 2.
- **D2 guard.** When Table 2 is chosen only because *nothing* said PIH, a
  `pih_determination_from_special_provisions` conditional is attached. The shipped table has no
  hazard-zone column, so that call rests on an absence — the placard computes, the load does not
  auto-clear on it.

Verified against the shipped 2026.07.1 dataset, all 2,479 entries: **87 → Table 1** (correctly blocked
as out of v1 scope), **458 → Table 2** (now compute a placard), **10 undeterminable** — and all ten are
exactly the special-provision-5 cases. 439 of the Table 2 calls carry the D2 conditional. Before this,
all 555 returned "outside the fuel scope".

## 3. F-P2 — the trailer you pick is thrown away

`hazmatAnalysis.ts:53` hard-codes `kind: "cargo_tank"` with the comment *"fuel-fleet default; refined
by the cargo-tank profile when present"*. The comment is wrong: the profile supplies capacity and
compartments, never `kind`. So the vehicle and trailer chosen in the Load Workspace change nothing
about the verdict.

Four more hard-codes with the same value:

| Site | Consequence |
| --- | --- |
| `hazmatExtraction/orchestrate.ts:138` | every scanned BOL is analysed as a cargo tank |
| `hazmatExtraction/mapBolLines.ts:42-46` | …and therefore **every extracted line becomes `packagingKind: "bulk"`** |
| `hazmatAnalysis.ts:187`, `orchestrate.ts:88` | driver qualification graded as tank work |
| `CompliancePage.vue:85` | already logged as F-H2 |

Because `qualificationGate.ts:91` requires an **N or X tank endorsement** whenever `vehicleKind ===
"cargo_tank"`, all five together mean every driver on every hazmat load is failed for lacking a tank
endorsement — whether or not a tank is involved.

The calculator, ironically, is the one surface that honours the user's choice: `calcModel.ts:142`
passes `form.vehicleKind` straight through. It is also the only surface with no equipment picker.

### F-P2 — **FIXED 2026-08-07**

D-H4 implemented: `trailers.trailer_type` is now real. Declared in `@fuelguard/shared` (`TRAILER_TYPES`,
`TRAILER_TYPE_LABELS`), selected by the trailers query, editable in `TrailerForm.vue` as **Type**, and
shown on the Trailers table — a tanker gets a caution badge, an unset type reads "Not set" rather than
being silently treated as a dry van. Migration `0144` carries `is_reefer` across and deliberately
guesses nothing else.

One shared decision, `resolveVehicleKind`, so the dashboard and the engine cannot disagree:

| Evidence | Answer |
| --- | --- |
| trailer marked `tanker` | `cargo_tank`, confident |
| trailer marked anything else | `van_or_flatbed`, confident |
| type unset but a cargo-tank profile exists | `cargo_tank`, confident |
| nothing known | `cargo_tank`, **not** confident — and the load carries a `vehicle_kind_assumed` advisory naming the fix |

**Why the unknown case still answers `cargo_tank`:** the two mistakes are not symmetric. Calling a van
a tank is over-restrictive and blocks a load that should clear. Calling a tank a van applies the
1,001 lb Table 2 threshold to bulk packaging, which can UNDER-placard — the failure the engine exists
to prevent (D2). The change is not the value; it is that the assumption is now visible and fixable.

Wired through every path that used to hard-code it: `hazmatAnalysis.ts` (engine input **and**
qualification), `hazmatExtraction/orchestrate.ts` (extraction context **and** qualification — read
before the content hash, since the kind is a cache-key term), and `mapBolLines.ts`, which derives
packaging from the kind and therefore stops calling every scanned line bulk.

`CompliancePage.vue` (F-H2) is fixed here too, since it was the same root cause: `vehicleKind` now
comes from whether the fleet owns any tanker, and `orgHasSecurityPlan` from the organization's own
certifications. A fleet that has never hauled a tank no longer sees every driver as "Action required"
for want of an N/X endorsement.

## 4. F-P3 — Table 2 arithmetic is missing its exclusions

The plan specifies the aggregate precisely (`18-HAZMATGUARD-PLAN.md:809-813`): *"aggregate = Σ gross
weight of lines that are Table 2 AND non-bulk AND not residue-only AND not §172.505 materials … Bulk
and §172.505 lines placard regardless of the aggregate."*

`compute.ts:173` takes **all** resolved Table 2 lines with no filter. Consequences:

- A cargo tank under 1,001 lb aggregate gets **no placards**. `17-HAZMAT-BOL-COMPLIANCE.md:184-186`:
  *"A cargo tank is a bulk packaging → the 1,001-lb Table 2 threshold NEVER applies."*
- Residue lines count toward the threshold; `isResidueLine` sits in `UNEVALUATED_INPUTS` instead.
- **DANGEROUS is offered on cargo tanks.** `compute.ts:218` has no `isTank` guard, and the research
  doc calls this a *"hard-block on cargo tanks"* (`:419`). The 2,205 lb single-category bar and the
  non-bulk-only restriction exist only as a comment string at `compute.ts:231`.
- §172.505 subsidiary placards are declared in the type at `compute.ts:31` and never read, though D4's
  own text says cutting them *"would be a silent hole"*.

### F-P3 — **FIXED 2026-08-07**

The aggregate now governs only what §172.504(c) says it governs, and the three exclusions the plan
specified are code rather than prose:

- **Bulk placards at any quantity.** A cargo tank is bulk packaging, so a tanker under 1,001 lb used to
  come back with *no placards at all* — the most dangerous output this function could produce. Bulk
  lines are excluded from the aggregate and placard regardless.
- **Residue-only non-bulk lines** are excluded (§172.504(d), §173.29(c)), with a finding that says so.
- **Sub-threshold categories are PERMITTED, not absent.** `PlacardOutput` gained a `permitted` list
  (§172.502(c)) and the verdict panel renders it under "Permitted, not required". Reporting an empty
  required-set with no further comment reads as "no placards", which is a different statement.

DANGEROUS (§172.504(b)) gained the three restrictions that existed only as a comment string:

- **Prohibited on a cargo tank** — and stated as prohibited, not merely unoffered.
- **Non-bulk categories only**, counted separately from the bulk and §172.505 lines.
- **The 2,205 lb single-category bar.** A category at or over it keeps its own placard and drops out
  of the substitution; unknown weight is treated as over the bar, which is safe because the
  substitution is optional.

**§172.505 subsidiary placards now exist.** D4 kept them live because cutting them *"would be a silent
hole"*, and they were never implemented. A Table 2 material that asserts poison-by-inhalation (the same
special-provision test F-P1 introduced) also requires POISON INHALATION HAZARD; a subsidiary 4.3
requires DANGEROUS WHEN WET. Both regardless of the aggregate.

Covered by `compute.aggregate.test.ts` — twelve cases, one per rule, including the cargo-tank-under-
threshold case that used to return nothing.

## 5. F-P4 — the fuel costume

None of these change a verdict; all of them tell the user this is a fuel tool.

`calcModel.ts` defaults: `vehicleKind: "cargo_tank"`, `packagingKind: "bulk"`, `quantityUnit: "gal"`,
`tankState: "loaded"`. Placeholders `9200` (tanker gallons), `8000`, `"UN1203, UN1202"`. The product
picker's blank-query heading reads **"Common fuels"** over a 13-ID curated shortlist. "Tank state" is
shown for a van or flatbed. `VEHICLE_KIND_OPTIONS` has two values and no "unknown".

The same component is the **public marketing calculator** (`PublicPlacardCalculatorPage.vue:27`), so
an anonymous visitor sees a page promising "the required DOT placards" that opens pre-set to a fuel
tanker carrying bulk gallons.

### F-P4 — **FIXED 2026-08-07**

**The carrier context is no longer defaulted.** `vehicleKind` starts empty and the form will not
calculate until it is set. It is the single input that most changes the answer — bulk or not decides
whether the 1,001 lb aggregate applies at all — and a default of `cargo_tank` meant anyone who never
opened the dropdown, including every anonymous visitor to the public calculator, silently calculated
as a fuel tanker. There is no safe default here, so the form asks.

Everything downstream now follows from that answer instead of from a literal: a new line starts bulk
gallons on a tank and non-bulk pounds otherwise, and **Tank state is hidden for a van or flatbed** —
the engine only reads it for a cargo tank, so showing it was asking a question with no consequence.
Placeholders are no longer gasoline and diesel.

**The fleet equipment picker is in, and only on the authenticated calculator.** Pick a trailer and the
carrier context comes from its type through the same `resolveVehicleKind` the load path uses (D-H4), so
the calculator and a real analysis of the same trailer cannot disagree; the cargo-tank profile fills in
capacity. When the type is unset the form says so and points at the Trailers page rather than quietly
assuming. `fleet` defaults to **false** because this component *is* `PublicPlacardCalculatorPage.vue` —
an anonymous visitor has no organization, so neither fleet query may mount there.

The trailer read lives in the hazmat feature's own `useHazmatTrailersQuery` rather than importing the
fleet feature's internals — the boundary rule, which is exactly why that query already existed.

**Product picker copy.** The blank-query list is still the curated fuel shortlist, which is honest —
but it now says "Common fuel products" over "A shortcut, not the scope — search any UN/NA number or
shipping name to reach the whole Hazardous Materials Table." Whether that shortlist should be broadened
beyond fuel is a content decision, not an engineering one; see §7.

## 6. F-P5 — 1.4 / 1.5 / 1.6 ship despite being deferred

D4 says *"1.4/1.5/1.6 deferred too"*. The dataset marks them `table: 2` and the art registry defines
the placards, so `computePlacards` computes an `EXPLOSIVES 1.4` placard today. Either the decision or
the data is wrong; they cannot both be right.

### F-P5 — **FIXED 2026-08-07**

Resolved in favour of the regulation. §172.504(e) genuinely puts **1.4, 1.5 and 1.6 in Table 2**, and
the dataset is right to record that — so the dataset was not touched. Editing a row to say something
the CFR does not was rejected outright: the dataset states the regulation, and `parsePlacards.ts`
asserts its own table signatures precisely so no row can be quietly moved to make the code's life
easier.

D4's deferral is about **logic depth**, not table membership, and that is now what the code implements.
An explosives division is recognised and blocked with `explosives_out_of_scope_v1` — the same posture,
tier and wording as the Table 1 gate, under its own rule id so the existing `table1_out_of_scope_v1`
flag (referenced by tests, the CHANGELOG and the plan) keeps its meaning.

The reason it must block rather than compute: an explosives load needs compatibility groups, the
§172.504(f) exception interplay, its own §177.848 segregation, and the rule that explosives may never
use the DANGEROUS substitution. None of that is implemented, so a bare EXPLOSIVES 1.4 diamond would
**understate** the load — the D2 failure the Table 1 gate exists to prevent, arriving through a
different door. **114 dataset entries** (109 × 1.4, 4 × 1.5, 1 × 1.6) were computing a placard on that
basis; 268 Class 1 entries were already blocked as Table 1.

**A second hole closed alongside it.** `index.ts`'s `ALL_PLACARDS` — the list that populates the
*prohibited* set on a cleaned-and-purged tank — omitted all six explosives names, so such a tank was
never told it may not display them (§172.502(a)). Blocking explosives in `computePlacards` does not
cover this: the cleaned-tank prohibition is a dataset-independent gate that runs before the ladder.

`compute.ts` crossed the 500-line budget in the process and was **split, not grandfathered**: the
dataset view, placard-name map and pure predicates moved to `placards/classify.ts`. A real seam —
everything there answers "what IS this material", nothing there decides what to do about it.

## 7. Fix order

All five are now fixed; the list below is kept as the record of the order and the reasoning.

1. **F-P1** — disambiguate the Table 1 / Table 2 rows that share a class number. Smallest change,
   largest correctness gain: it turns the largest class in the HMT from "withheld" into "works".
2. **F-P2** — derive `vehicleKind` from the equipment actually selected, in all five places. Needs the
   decision in §8.
3. **F-P3** — bulk / residue exclusions in the aggregate, and the DANGEROUS restrictions.
4. **F-P4** — neutral defaults and vocabulary, so the tool presents as what it is.
5. **F-P5** — resolve the 1.4/1.5/1.6 contradiction.

Scanner edge detection is tracked separately, at the owner's request.

## 8. The decision F-P2 needs

There is no implemented source of truth for "is this equipment a tank". `trailers.trailer_type` has
allowed `'tanker'` since migration `0100` and is dead in the application; `HAZMAT-IA-PLAN.md` decision
**D-H4** says it *becomes* the real equipment type, and that plan is not yet built. Meanwhile
`hazmat_cargo_tank_profiles` exists, is a 1:1 child of `trailers`, and **D-H3** says it should be
dropped into `trailers`/`vehicles`.

So F-P2 can be sourced three ways, and the choice decides whether part of the hazmat consolidation
lands now or later.

## 9. Open question left by F-P4

The product picker's blank-query default is thirteen curated **fuel** IDs. That is a reasonable
shortcut for a fuel carrier and a poor one for anybody else, and the engine's scope is Table 2 broadly.
Broadening it means choosing which non-fuel products are "common" — a content judgement rather than an
engineering one, and one the SME is better placed to make than I am. Left as-is, honestly labelled.
