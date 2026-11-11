# Ads — what a finished ad looks like (the look redesign; AG8 made larger)

**Started:** 2026-11-10. **Authority:** the owner, 2026-11-10: *"they don't look really good, professional and
enterprise grade"*, and the standing instruction *"you are product manager and you should analyze and make
decisions that will be best solutions for us."* Each decision below is the product manager's under that sentence;
the owner can overrule any of them. **Reads with:** `HANDOFF-2026-11-10-ADS-AD-DESIGN.md` (why, the rails),
`ADS-AGENTS-AUDIT-2026-11-10.md` F-AG9 / AG8, `ADS-CREATIVE-QUALITY-PLAN.md` §7 (D-AD9, D-AD12, D-AD26–D-AD29).

Decision and question ids here are **D-ADL*n*** / **Q-ADL*n*** (ad look), a series of their own, so they cannot
race the D-AD / Q-AD numbers a parallel chat is taking.

## 1. What was looked at

- **The ten references** in `data-samples/Social ads examples/` (gitignored; other companies' ads, learned from,
  never copied, committed or shown). Six are real ads; four are off-target (an agency promo, a website mock-up, a
  platform frame around a flyer, a Portuguese template built round a person).
- **Ours**: the three `clean-*` finished-ad-judge fixtures and the nine overlay goldens on
  `claude/ads-ag5-finished-ad-judge`.

What every strong reference does and ours does not, in the order it matters:

1. The words are set in a heavy condensed display face at three or four sizes; ours is one office sans at three.
2. The words sit **on** the picture, made readable by the picture darkening under them; ours sit in a flat box.
3. One shape in one brand colour carries the second line; ours uses no kit colour but the box.
4. The call to action is drawn as a thing to press; ours is a second line of bold text.
5. The company, its phone and the legal line have a designed place at the edge; ours puts the legal line in the
   stack at body size and draws no phone at all.

The finished-ad judge said the same before anyone redesigned anything: no sound ad of the current overlay scored
above 3 of 5 on `hierarchy_reads` (P1-7's recording).

## 2. Decisions

**D-ADL1 — The plate is retired; the words sit on a measured scrim.** The picture is darkened under the stack by
a gradient that fades into the picture, never a rectangle. The scrim's strength is not a constant: the renderer
raises it in fixed steps until the worst sample under every text box passes `checkRender`, and refuses, as today,
when the top step still fails. The mock-ups showed why a constant is wrong — the same scrim gave the headline
14:1 over a prairie road and 1.2:1 where a two-line headline climbed onto a white cab.

**D-ADL2 — Two bundled faces, both OFL: one display face for the headline, Barlow Condensed (500/600/700) for
every other line.** Liberation Sans leaves the ads (it stays for PDFs). The display face is the chosen look's
(Q-ADL1). Shipped as `.ttf` from each family's upstream repository beside its licence file, registered from bytes
as Liberation is, so a host with no fonts renders the same pixels. `canDraw` must answer for the new faces: both
cover Spanish (¡ ¿ ñ á é í ó ú ü).

**D-ADL3 — Sizes come from the frame, and only the headline steps.** Every size is a fraction of the frame's
width (1080 = 1), not a per-format table. The headline alone may step down a fixed ladder to hold one line, then
two; below the ladder's floor it refuses `too_long`. This amends "never reduced to make a line fit": a headline
that is 20 % smaller is still a headline, one below the floor is not, and the floor is what the refusal protects.
Everything else keeps one size and refuses. The headline ceiling (D-AD27, 56 characters) is re-measured against
the ladder's floor in both languages before any preset slot changes.

**D-ADL4 — Three copy roles become five: kicker, headline, ribbon line, call to action, legal line.** The
kicker (who it is for: "Now hiring · Class A OTR") and the ribbon line (the second promise: "Home weekly") are
new and optional. Both are claim-checked at the overlay like every drawn word. Copy is stored in sentence case;
the renderer draws capitals, with Spanish casing rules. **The renderer ships first and draws a two-role ad
(headline + call to action) in the new look**, so the look does not wait for the copywriter; the kicker and
ribbon arrive with the copywriter's prompt change, which is a live re-record and waits for the owner's word.

**D-ADL5 — The kit's colours are read.** `kit.colors` supplies a primary and an accent: the colour named
`accent` when there is one, else the kit colour with the highest contrast against the scrim. The accent draws the
ribbon, the button or the headline's figure, depending on the look. Text on an accent shape is ink or white,
whichever measures higher, and is checked like any other text. A kit with one usable colour renders with white
as its accent rather than inventing a colour.

**D-ADL6 — The call to action is a drawn button, and it stays small.** Meta puts its own button under every feed
ad, so ours is the picture's last line, not its centre. It answers the judge's standing complaint (a button that
reads as a sub-heading).

**D-ADL7 — A footer holds the phone and the legal line; the logo has a measured place.** `kit.phone`, stored
since Stage 2 and drawn by nothing, is drawn when the kit has it. The legal line is still drawn on every ad
(D-AD9), small, at the edge. The logo's contrast is measured against what is under it; a logo that fails sits on
a white chip. No logo is ever recoloured.

**D-ADL8 — The three layouts stay three, keep their stored names, and change their meaning and label.**
`bottom_plate`, `top_band` and `centered` are stored in presets; renaming a stored value is a migration of every
preset for no reader's benefit. They become where the words sit (low, high, middle) and the office sees those
words. The comment above the enum says the names predate the look.

**D-ADL9 — No words behind the truck yet.** It needs a subject mask the pipeline does not make. Revisit when V4's
image model is chosen (Q-AD20), since some models return one.

**D-ADL10 — The art director is asked for drama, and for room.** Low angle, golden hour or night, the subject
filling half the frame or more, and the part under the words left plain (D-AD28 already asks for the last). A
prompt change, so a live re-record, so it waits for the owner's word. Real proof waits for V4.

**D-ADL11 — Two looks, chosen by the preset; revised 2026-11-10.** First written as "one look for every
carrier". The owner's question the same day — is running one ad for months good or bad — changed it: it is bad
(ADS-CREATIVE-QUALITY-PLAN R6: refresh every 2–4 weeks at low spend), the system already retires a tired ad and
enters the next concept (D-AD23), and if every concept is drawn the same way the refresh changes the picture and
not the design. So the look is the PRESET's, beside its layout: `look` is an optional field of the recipe
(`rail` when absent), and a carrier's five concepts split across the two looks. Built: **`rail`** (candidate B)
and **`ribbon`** (candidate A). Not built: D (italic, slanted) reads promotional more than established, and C
(brand frame) reads as a flyer; either can be added as a third `LookSpec` when per-ad data says two looks tire.
A look picker per KIT is still a second product and still not built.

## 3. The candidate looks (rendered 2026-11-10, fixture kit, fixture photos)

Four looks, each drawn at 4:5 in English, 1:1 with a two-line headline, and 9:16 in Spanish.

| | Look | Headline face | Accent used for | Strength | Weakness |
|---|---|---|---|---|---|
| A | Scrim and ribbon, centred | Anton | the ribbon | calmest, closest to the best references | centred two-line headlines climb onto the subject in 1:1 |
| B | Left rail, brand footer | Barlow Condensed 800 | the pay figure, the button, the rail | the figure a driver looks for is the brightest thing; most "this carrier's" | a logo in the kit's primary colour needs the chip on the footer band |
| C | Brand frame, photo window | Oswald 700 | kicker, button, rules | contrast never depends on the photo | reads as a flyer; photo is small; 9:16 is half flat colour |
| D | Motion, italic and slanted | Barlow Condensed 800 italic | ribbon, chevrons | most energy | italic at this weight reads owner-operator / promotional more than enterprise |

**Recommendation: B**, A second. B is the only one where the kit's colour does a job a driver cares about — it
marks the money — and its left edge holds long Spanish lines without the centring problem A has.

## 4. Open questions

- **Q-ADL1 — which look. ANSWERED 2026-11-10.** The owner: *"build what you think it is the best and also what
  is most modern and best quality."* Decided under that sentence: B and A, as `rail` and `ribbon` (D-ADL11).
- **Q-ADL2 — spending the Anthropic key** on three re-records: the copywriter (D-ADL4), the art director
  (D-ADL10), the finished-ad judge on the new look. The owner's, asked before each. *Blocks L3–L5 only.*
- **Q-ADL4 — which preset gets which look.** The Presets card has no look field yet (L2), so every preset draws
  `rail` until then. Recommendation: the pay-led and equipment-led concepts take `rail` (its accent marks the
  figure), the lifestyle and "straight talk" concepts take `ribbon`. Decided with the starters (#2211) in L2.
- **Q-ADL5 — the kit editor's wording.** The drawer still says "plate colour"; the field now means the ground the
  picture darkens toward. L2 renames the label (the stored key stays, D-ADL8's reasoning).
- **Q-ADL3 — the real kit.** The mock-ups use the fixture kit (green, with an amber accent added for the
  mock-up). The real kit's colours and logo decide whether D-ADL5's fallback or D-ADL7's chip is ever seen.

## 5. Build order (after Q-ADL1)

- **L1 — the renderer.** Faces, the frame-derived scale and ladder, the measured scrim, button, footer, kit
  colours; `overlayFit` kept in step; goldens regenerated and looked at; ceiling re-measured. No prompt changes,
  no key. Branch from `claude/ads-ag4-anchored-cut` (or main once that stack merges).
- **L2 — copy roles in the contract** (`overlay_slots`, presets, the Presets card), still no prompt change.
- **L3 — the copywriter writes kicker and ribbon** (re-record; Q-ADL2).
- **L4 — art direction for drama** (re-record; Q-ADL2).
- **L5 — the judge on the new look**, same photos, numbers into the progress log (Q-ADL2).

## 6. Done when

As the handoff's §7: one look chosen and recorded; every published format in both languages through the real
overlay with goldens looked at and every check passing; the judge scoring the new look above the old on the same
photos.

## Progress log

- **2026-11-10** — References and current ads read. Four looks rendered from the checker's three clean photos by
  a scratch script (not committed); contrast measured under every line. Findings that changed decisions: a
  constant scrim fails on a white subject (→ D-ADL1); a two-line centred headline needs a height budget in 1:1
  (→ D-ADL3). Waiting on Q-ADL1.
- **2026-11-10, L1 built (the renderer).** `creative/overlay/` is now three files: `overlayLooks.ts` (what a look
  is, the palette read from the kit), `overlayLayout.ts` (where every word goes, with no picture — `overlayFit`
  asks it), `overlay.ts` (paints: measured scrim, shapes, logo chip, words). Faces: Barlow Condensed ×4 and Anton,
  OFL, in `apps/api/src/lib/fonts/` beside their licences (`lib/adFonts.ts`). Shared: `AD_LOOKS`, and `look`
  optional on the preset recipe; compose passes it. Measured:
  - **Headline ceiling (D-AD27) re-measured on the 365 recorded headlines:** `ribbon` holds what the old overlay
    held — longest fitting 56, the ceiling, unchanged; `rail` holds 52; every headline of 45 or fewer fits in both
    looks on both published formats and all three layouts. `OVERLAY_HEADLINE_MAX_CHARS` stays 56; no preset slot
    changes.
  - **The visual check's band is now the stack only** (kicker to button). It was the union of every drawn box;
    with a footer at the frame's edge that union covered a `top_band` ad top to bottom (1,145 of 1,350 px), and
    `safe_zone_clear` would have judged the whole picture.
  - **Scrim steps on the three checker photos, five roles:** `rail` 0.72–0.82, `ribbon` 0.45–0.60. `rail` takes
    more because its amber kicker and figure must reach 4.5:1 as well as the white.
  - Goldens: 14 (rail × 3 formats × 3 layouts; ribbon × 3 formats, and 4:5 in the other two layouts), each
    opened and looked at. 12 deliberate breaks, 12 caught (one first survived — a missing kicker overflow check
    was caught later by the render check, so the test now also asks `overlayFit`).
  - Not in L1: the kicker and the second line reach the renderer only from tests — the copywriter does not write
    them yet (L3, a live re-record: Q-ADL2); the Presets card has no look field and the kit drawer still says
    "plate" (L2: Q-ADL4, Q-ADL5); no Anthropic key was used.
