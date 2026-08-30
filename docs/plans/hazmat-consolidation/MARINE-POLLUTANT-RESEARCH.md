# Marine pollutants — regulatory research before code (2026-08-30)

Owner-reported gap: the engine has no marine-pollutant display logic. This document is the eCFR
research that has to come first (the D-H14 lesson — the packaging vocabulary was built from memory
once, and the gas test was wrong by a factor derived from nothing).

**Sources.** Fetched from the eCFR versioner API on 2026-08-30, title 49 as of 2026-07-13 — the same
endpoint and date the dataset importer uses (`ecfrClient.ts`):
`GET /api/versioner/v1/full/2026-07-13/title-49.xml?section={172.322|171.4|171.8}`.
The eCFR HTML site 302s automated fetches to an unblock page; the API does not.

## 1. What a marine pollutant IS (§171.8)

> **Marine pollutant**, means a material which is listed in appendix B to § 172.101 of this subchapter
> (also see § 171.4) and, when in a solution or mixture of one or more marine pollutants, is packaged
> in a concentration which equals or exceeds:
> (1) Ten percent by weight of the solution or mixture for materials listed in the appendix; or
> (2) One percent by weight of the solution or mixture for materials that are identified as severe
> marine pollutants in the appendix.

**We already have the list.** `packages/hazmat-data` imports Appendix B (`parseAppendices.ts`) and the
shipped dataset carries **554 entries, 178 of them severe** (the appendix's "PP" S.M.P. column). It
had one consumer — `bol/validate.ts`, for the §172.203(l) shipping-paper words — and none in the
placarding path.

**But the list alone finds only half the loads.** Appendix B lists SUBSTANCES; measured against the
shipped 2026.07.1 dataset, **132 of 2,479 HMT entries match it by proper shipping name** (acrolein,
allyl alcohol, aniline, bromoform…). The other door is UN3077 / UN3082, "Environmentally hazardous
substance, solid/liquid, n.o.s.", where the material is a pollutant because of a COMPONENT that
§172.322(a)(1) requires printed in parentheses — a component this product never collects, so no name
match is possible or ever will be. A first implementation keyed only on appendix B was written, run
against the real dataset, and returned nothing for UN3082: the entry the regulation invented for
exactly this purpose.

Those two entries are therefore recognised by IDENTITY, on the regulation's own words. Special
provision 441 (§172.102(c)(1)) opens:

> **441** For **marine pollutants transported under "UN3077, Environmentally hazardous substance,
> solid, n.o.s." or "UN3082, Environmentally hazardous substance, liquid, n.o.s."** and for purposes
> of shipping paper and package marking requirements, the technical name used in association with the
> basic description may be a proper shipping name listed in the §172.101 Hazardous Material Table…

The CFR treats those descriptions as descriptions *of* a marine pollutant, which is what declaring
one asserts. The recognition is **UN-only and name-checked**: NA3077/NA3082 share the ID numbers but
are "Hazardous waste, n.o.s." and "Other regulated substances, n.o.s." — different entries SP 441
does not name, and a hazardous waste is not a marine pollutant by virtue of being a waste.

Both routes feed §172.203(l) as well, so the engine cannot demand the mark on the vehicle while
staying silent about the words the shipping paper has to carry.

**Concentration — added 2026-08-30 (engine 0.14.0).** The §171.8 clause is "when in a SOLUTION OR
MIXTURE of one or more marine pollutants", so a NEAT listed material is a marine pollutant with no
arithmetic at all. The line therefore carries one optional field, `marinePollutantConcentrationPct`,
and the logic is fail-closed by construction: **only a stated number below the threshold can take a
line out.** A blank field means "the material itself, or a mixture nobody measured", and both stay
classified. Treating a blank as zero — the obvious shortcut — fails eleven tests.

The threshold is 10% listed, 1% severe, and **1% when severity is unknown** (the SP-441 route, where
the pollutant is an unnamed component): the stricter figure classifies more mixtures as marine
pollutants, which is the over-display direction.

The question is asked **only on a product that is actually on appendix B** — `HazmatProduct` carries
`isMarinePollutant` and `marinePollutantSevere`, set by the same `classifyMarinePollutantEntry` the
engine rule uses, so the picker and the verdict cannot disagree about what counts. Roughly 132 of
2,479 HMT entries plus the two n.o.s. ones; asking the other 95% would be noise, and a question that
never matters is one people learn to skip.

## 2. The domestic highway rule is the opposite of the intuition (§171.4(c)(1))

> (c) Exceptions. (1) **Except when all or part of the transportation is by vessel, the requirements of
> this subchapter specific to marine pollutants do not apply to non-bulk packagings transported by
> motor vehicle, rail car or aircraft.**

So for a domestic truckload: **non-bulk marine pollutants have no marine-pollutant requirements at
all.** §172.322(a) says the same thing from the other side — it opens "For vessel transportation of
each non-bulk packaging…".

This is the single most important fact here, and it is the one a from-memory implementation gets
wrong, because "it's a marine pollutant, mark it" is the intuitive answer.

## 3. Bulk packagings (§172.322(b)), and the exception that swallows the common case

> (b) Except as otherwise provided in this subchapter, a bulk packaging that contains a marine
> pollutant must—
> (1) Be marked with the MARINE POLLUTANT mark on at least two opposing sides or two ends other than
> the bottom if the packaging has a capacity of less than 3,785 L (1,000 gallons)… or
> (2) Be marked on each end and each side with the MARINE POLLUTANT mark if the packaging has a
> capacity of 3,785 L (1,000 gallons) or more…
> The mark may be displayed in black lettering on a square-on-point configuration having the same
> outside dimensions as a placard.

And the transport vehicle itself (§172.322(c)):

> (c) A transport vehicle or freight container that contains a package subject to the marking
> requirements of paragraph (a) or (b) of this section **must be marked with the MARINE POLLUTANT
> mark… on each side and each end**…

Then §172.322(d) — the mark is **not** required:

> (1) On single packagings or combination packagings where each single package or each inner packaging
> …has a net quantity of 5 L (1.3 gallons) or less for liquids; or a net mass of 5 kg (11 pounds) or
> less for solids
> (2) On a combination packaging containing a marine pollutant, **other than a severe marine
> pollutant**, in inner packagings each of which contains 5 L / 5 kg or less…
> **(3) Except for transportation by vessel, on a bulk packaging, freight container or transport
> vehicle that bears a label or placard specified in subparts E or F of this part.**
> (4) On a package of limited quantity material marked in accordance with § 172.315…

**(d)(1) — built 2026-08-30 (engine 0.15.0).** It takes a NET QUANTITY: what each single package,
or each inner packaging of a combination packaging, actually contains. The line carries its own field
for it, deliberately NOT the D-H14 per-package CAPACITY — same units, different measurement, and
using the capacity would fail OPEN by excusing a mark on a package whose contents nobody stated. The
UNIT selects the limb, because `phaseForHazardClass` cannot: it only ever answers "gas" or "liquid",
since hazard class does not state phase. Litres is the 5 L liquid limb, kilograms the 5 kg solid one,
and no other unit is offered because the CFR has no gallons or pounds limb to convert into.

**(d)(2) is deliberately NOT implemented, and that is the conservative choice.** It tests net
CAPACITY ≤ 5 on a combination packaging holding a non-severe pollutant. A package cannot contain more
than it holds, so capacity ≤ 5 implies quantity ≤ 5, and every load (d)(2) would excuse is one (d)(1)
already excuses on a stated quantity. The single case (d)(2) adds is "capacity known, contents
unknown" — where declining to apply it leaves the mark REQUIRED.

Two more limits, both stated in the code. A GAS never takes the exception: (d)(1) has a liquid limb
and a solid limb and no third one. And it can only reach non-bulk lines, since a bulk packaging has no
inner packaging and §171.8 puts its floor above 450 L.

§171.4(c)(2) offers a WIDER exception at the same 5 L / 5 kg figure — lifting the marine-pollutant
requirements generally rather than just the mark — but only where the packagings meet §§173.24 and
173.24a and the material is neither a hazardous waste nor a hazardous substance. None of those three
is checkable here, so the finding names it rather than applying it.

**(d)(3) is the one that matters for trucking.** A domestic bulk marine pollutant on a vehicle that is
already placarded needs **no** MARINE POLLUTANT mark. A placarded gasoline tanker hauling a listed
pollutant is the common case, and the correct answer there is "nothing extra".

The mark is therefore required domestically in a narrow band: **bulk packaging, on a vehicle bearing
no subpart E label and no subpart F placard.** That is a real load — an environmentally hazardous
substance that takes no placard at its quantity — and it is exactly the load a placarding tool would
otherwise report as "no placards required" with nothing else to say.

## 4. It is a MARK, not a placard (§172.322(e))

> (2) The marking must be in the form of a square-on-point. The symbol and border must be black on a
> white or suitable contrasting background… Each side of the mark must be—
> (i) At least 100 mm (3.9 inches) … for non-bulk packages [and] bulk packages with a capacity of less
> than 3,785 L (1,000 gallons); or (ii) At least 250 mm (9.8 inches) for marks applied to all other
> bulk packages.

Symbol: fish and tree, black on white or a suitable contrasting background. The engine's
`PlacardOutput.marks` union **already declares `"MARINE_POLLUTANT"`** and has never emitted it — the
output shape was designed for this rule and the rule was never written. It goes in `marks` beside the
§172.315 LQ mark, never in `required` placards, for the same reason the panel already says a white
square-on-point "is not a placard (§172.336(b))".

## 5. The decision table the engine implements

`vessel` = `load.portContext.vesselConnected` (already on `LoadInput`, tri-state, never wired to a
question until now).

| packaging | vessel | placard/label on the vehicle | outcome |
| --- | --- | --- | --- |
| non-bulk | `false` | any | **Nothing.** §171.4(c)(1) — the requirements do not apply. |
| non-bulk | `true` | any | Mark per §172.322(a) on the package + §172.322(c) on the vehicle, subject to the (d)(1)/(d)(2) small-package exceptions we cannot evaluate. |
| non-bulk | `null` | any | **`conditional`** — the two branches disagree, so the answer depends on a fact nobody stated. |
| bulk | `false` | yes | **Nothing.** §172.322(d)(3). |
| bulk | `false` | no | **Mark required** — §172.322(b) + (c). |
| bulk | `true` | any | **Mark required** — (d)(3) is expressly "except for transportation by vessel". |
| bulk | `null` | yes | **`conditional`** — (d)(3) turns on the vessel leg. |
| bulk | `null` | no | **Mark required** — both branches agree, so no question is worth asking. |

The `null` rows are `conditional`, not silently-domestic and not silently-vessel, and only where the
branches actually differ. Asking a question whose answer cannot change the outcome is the noise that
teaches people to ignore conditionals.

**We cannot evaluate (d)(1)/(d)(2).** They are NET QUANTITY per inner packaging; the form's
per-package figure is a §171.8 CAPACITY (D-H14) and the two are different measurements. The engine
names the exception in the finding instead of applying it — over-display, never under-display.

## 6. Deliberately out of scope

- ~~The 10%/1% concentration test (§171.8).~~ **Built 2026-08-30**, see §1.
- ~~The §172.322(d)(1)/(2) 5 L / 5 kg exceptions.~~ **(d)(1) built 2026-08-30**, see §3; (d)(2)
  deliberately not, because it is subsumed and declining it is the conservative direction.
- ~~§172.322(d)(4).~~ **Built 2026-08-30 (engine 0.16.0).** A package of limited quantity material
  marked per §172.315 needs no MARINE POLLUTANT mark. It keys on the VERIFIED acceptance
  (`Resolved.lqAccepted`) and never on the offeror's `isLimitedQuantity` claim — the engine refuses
  that claim routinely (wrong hazard class, no HMT column 8A, over the 30 kg/66 lb cap), and a
  refused Limited Quantity must leave the mark required. `compute.ts` passes the accepted LINE
  OBJECTS, matched by reference rather than `hmtRef`, because two lines can carry the same product
  with only one declared LQ and a ref key would except both.

  ⚠ **Reach today:** `LATEST_DATASET_VERSION` is 2026.07.1, which predates HMT column 8A, so
  `verifyLqClaim` refuses every claim and this exception cannot fire in production until 2026.08.0 is
  attested and promoted. Verified live on the shipped dataset: an LQ claim on aniline is refused and
  the mark stays.
- §172.322(a)(1) — the technical-name-in-parentheses rule for G/n.o.s. entries. That is a shipping
  PAPER and package-marking rule; `bol/validate.ts` already owns the §172.203(l) half, and the
  §172.203(k) technical-name rule is already emitted there.
- Severe-vs-ordinary only changes the concentration threshold and the (d)(2) exception, both of which
  we cannot evaluate. The severe flag is carried into the finding's evidence so a reviewer sees it.
- Vessel/IMDG stowage and segregation. `portContext.imdgPapers` stays unread.
