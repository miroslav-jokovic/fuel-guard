# `keller-14834-rev0122.pdf`

The blank J.J. Keller **Annual Vehicle Inspection Report, form 14834 (Rev. 1/22)** that D-AVI7 stamps
inspection values onto.

| | |
|---|---|
| Provenance | The carrier's own purchased form, opened in Adobe Illustrator 30.7 by the owner and saved with every filled value removed, 2026-08-31 |
| Page box | 612 × 846 pt (8.5 × 11.75 in), MediaBox = CropBox, rotation 0 |
| AcroForm | **none** — the original's three text fields (carrier / address / city-state-zip) did not survive the Illustrator round trip, so the renderer stamps that block as text like every other field |
| Verified | Max drift **0.009 pt** across 26 artwork anchors compared against the original filled sample, 2026-08-31. The coordinate map derived from that sample therefore transfers unchanged |

## Why this file is here at all

`docs/plans/maintenance/ANNUAL-INSPECTION-PLAN.md` §2.1 records the ruling and what it costs. In
short: FMCSA prescribes no form — §396.21 fixes the report's *contents*, not its layout — so a layout
of our own would have been legally sufficient and free of any third-party dependency. The owner ruled
for the Keller page anyway, because the binder has looked like it for years and an auditor recognises
it. The page carries `Copyright 2022 J. J. Keller & Associates, Inc.`, and embedding it here is a
commercial risk taken knowingly rather than an oversight.

## If Keller reissues the form

The coordinate map (`../layouts/keller14834Rev0122.ts`) is pinned to revision **1/22**. A new
revision means re-measuring the map against the new blank — but **every report already filed keeps
its stored bytes**, so no past filing changes. That is why A6 files the rendered PDF rather than
re-rendering on demand.

The bijection test in `../layout.test.ts` fails the build if the map and the catalogue stop covering
each other, so a revision cannot silently print into the wrong cell.
