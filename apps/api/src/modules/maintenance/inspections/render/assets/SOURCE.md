# `keller-14834-rev0122.pdf`

The blank J.J. Keller **Annual Vehicle Inspection Report, form 14834 (Rev. 1/22)** that D-AVI7 stamps
inspection values onto.

| | |
|---|---|
| Provenance | The carrier's own purchased form, opened in Adobe Illustrator 30.7 by the owner and saved with every filled value removed, 2026-08-31 |
| Page box | 612 × 846 pt (8.5 × 11.75 in), MediaBox = CropBox, rotation 0 |
| AcroForm | **none** — the original's three text fields (carrier / address / city-state-zip) did not survive the Illustrator round trip, so the renderer stamps that block as text like every other field |
| Structure | one page, one content stream (~17 KB inflated), **no XObjects**, three Type 1 subsets (HelveticaLTPro-Bold, HelveticaLTPro-Roman, MyriadPro-Regular) |
| Verified | Max drift **0.009 pt** across 26 artwork anchors compared against the original filled sample, 2026-08-31. The coordinate map derived from that sample therefore transfers unchanged |

## This file is DAMAGED, and the first diagnosis of how was wrong

An earlier version of this note said the section headings were "painted at `0 0 0 0 scn` over a
0.48 pt red hairline", designed to be printed onto the pre-printed pad Keller ships. That reading was
wrong, and it is worth recording why, because a whole decision (D-AVI22) and a fortnight of output
were built on it: nothing could contradict it. The page was never read, only reasoned about.

Read at the operator level on 2026-09-01:

- the content stream contains **no `scn` operator at all**, and no CMYK. The page paints in `rg`/`RG`
  only, in four colours — near-black `0.137 0.122 0.125`, Keller red `0.933 0.212 0.251`, the pale
  column tint `0.992 0.918 0.89`, and white `1 1 1`;
- there is **no red rule at any heading row**. The only red strokes left on the page are the four
  blanks in the INSTRUCTIONS legend;
- the fifteen surviving heading strings are painted `1 1 1 rg` — white on nothing.

So the export did not preserve a design for pre-printed stock. It **dropped artwork**, and left the
knockout text stranded on white paper.

## The four losses, and where each one is put back

| lost | what survives | restored by |
|---|---|---|
| The sixteen coloured section bands | each band's own pair of full-group-width rules, exactly 12.00 pt apart | `GROUP_HEADINGS` + `drawHeadingBands` |
| `1. BRAKE SYSTEM`, gone from the file entirely (the other fifteen survive as white text) | nothing | the same, drawn from `INSPECTION_GROUPS` so all sixteen come from one source |
| The `OK` column heading, in all three groups | the ruled box, and both its neighbours (`NEEDS REPAIR`, `REPAIRED DATE`) at 4 pt | `OK_COLUMN_HEADER` + `drawOkColumnHeaders` |
| The ✓ in `VEHICLE IDENTIFICATION (✓ AND COMPLETE)` — a MyriadPro `\037` whose glyph is not in the subset, so the page prints a hollow .notdef box | the sentence around it | `IDENTIFICATION_TICK`, redrawn in ZapfDingbats |
| The ✓ / X / NA marks on the INSTRUCTIONS legend | the four red blanks they sit on | `LEGEND_MARKS` + `drawLegendMarks` |

All of it is drawn **only on the plain-paper path** (`background: "template"`). The overlay path goes
onto a real Keller pad, which carries every one of them — this is the one place the original "the pad
already has it" reasoning was true, and it was true about the PAD rather than about this PDF.

## What stops this becoming permanent

`TEMPLATE_SUPPLIES` in `../layouts/keller14834Rev0122.ts` declares what this file carries, and
`../assets.test.ts` **reads the PDF** and fails the build when the declaration and the bytes stop
agreeing. Drop in a clean export and the tests name the flags to flip; flip them and the renderer
stops drawing what the page already has instead of double-printing it.

That test is the reason the wrong diagnosis above cannot recur in the same shape. A belief about this
file is now checkable against the file.

## Why the Keller page at all

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
re-rendering on demand, and why 0284 records the renderer and template revision a filing was drawn
under: a reissue is then visible per report rather than inferred from a date.

The bijection test in `../layout.test.ts` fails the build if the map and the catalogue stop covering
each other, so a revision cannot silently print into the wrong cell.
