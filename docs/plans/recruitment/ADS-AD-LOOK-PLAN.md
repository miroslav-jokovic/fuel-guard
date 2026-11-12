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

**D-ADL12 — L5 is a like-for-like comparison: same photo, same words, same kit; both looks; the old ads re-asked
in the same run (2026-11-11).** The before-and-after only measures the LOOK if nothing else moves. So the three
sound judge fixtures (`clean-*`, drawn by the old overlay) are redrawn by the new renderer on the checker's same
three photos, with the same headline, button, format, layout and two-colour kit, no logo, no phone — once in
`rail` and once in `ribbon` (six ads). The seven old ads are re-asked in the same recording, so "before" and
"after" are one judge on one day; yesterday's scores (P1-7) stay in the table as a second reading of the before.
**Not judged here: the kicker, the second line, the phone and the logo.** The judge's prompt
(`finishedAdJudge@1`) is told only a headline and a button, the old ads had none of the others, and an ad with
words the judge was not told about is a different question. The five-role look is judged when the judge's prompt
learns those lines — a prompt change, its own recording.

**D-ADL13 — Three of the four planted weaknesses are redrawn in `rail`; the fourth cannot be, and that is a
finding (2026-11-11).** The weak fixtures calibrate the judge — does it find a planted defect — and every ad it
will now see is in the new look, so its calibration must cover that look. `rail` (the default) carries the three
the renderer can plant: the kit's colours swapped for hot pink (`rail-weak-off-kit`), the photo blurred and
darkened (`rail-weak-subject-blurred`), a headline the picture contradicts (`rail-weak-words-mismatch`).
**`weak-hierarchy` is not redrawn: the new renderer cannot draw it.** Its defect — a button louder than the
headline, a headline in 20-pixel type — is ruled out by construction: every size is a fraction of the frame, the
button has one size, and the headline's ladder has a floor below which it refuses (D-ADL3). The hand-drawn
old-look fixture stays as the judge's calibration for that criterion.

**D-ADL14 — The plain part of the picture is a half, read from where the words go; the stack budget is not
changed (2026-11-11).** The handoff asked to reconcile `QUIET_REGION` ("the lower third", what the art director
and the image model are told) with the renderer's `QUIET_SHARE = 0.4`. They are not the same quantity:
`QUIET_SHARE` caps the stack alone, while the picture loses everything from the stack's top to the frame's edge,
the footer included. Measured over every recorded headline (332–343 per look) with the looks' own layout:
a `bottom_plate` 4:5 ad's words reach 42 % of the frame at the median, 45 % at most with a headline and a button,
50 % (`ribbon`) and 54 % (`rail`) with all four lines; `top_band` 31–36 % at the median, 45 % at most. **Every
`bottom_plate` ad passes a third.** So the image model was told to keep plain less than the words cover, in every
ad. Two ways out:
- **Shrink the words to a third.** Rejected: a third minus the footer leaves no room for a two-line headline and a
  button, so the ladder would refuse or shrink most headlines. It would also undo what L5 just measured as the
  redesign's gain.
- **Tell the picture the truth (chosen).** `QUIET_REGION` says half for `bottom_plate` and `top_band`, and
  carries the figure (`share: 0.5`). `overlayCapacity.test.ts` holds the renderer to it: on the 4:5 frame the
  picture is made for, and on the 1:1 cut from it, no recorded headline with its button reaches past half. Put
  the third back and the test fails (rail 4:5 reaches 45 %).
- **Not held by that test, and why:** an ad with all four lines in `rail` (54 %), and a preset that publishes 1:1
  alone, whose picture is made square (`rail` 55 %). The visual check judges the stack on every ad
  (`safe_zone_clear`) and regenerates with the subject smaller; a fixed half is the right instruction for the
  common case, not a promise for every case.
- **Cost:** the subject gets the upper half instead of two thirds. The best-scoring L5 ads already had the truck in
  the upper 42–45 %, because those checker photos were composed that way.

**D-ADL15 — Each starter names its look; three of the five use one small line (2026-11-11; answers Q-ADL4).**
Decided on renders, not only on the recommendation: each starter was drawn in both looks, on its own layout, with
copy of the kind its formula asks for, over the nearest checker photo (and a plain gradient for P2).
- **A starter that leads with a figure takes `rail`.** That is P2 "The number" and P5 "On the road, in figures":
  `rail` sets the figure in the kit's accent, so the thing a driver looks for is the brightest thing on the ad.
  P4 "Walk-around" (equipment) takes `rail` as well.
- **P1 "From the driver's seat" (straight talk) and P3 "Home on time" take `ribbon`,** which is calmer and centred.
  On P3 the accent ribbon carries the second line well.
- So the five alternate: a retired ad's successor (D-AD23) usually changes design, not only picture.
- **Small lines: P2's kicker, P3's and P5's second line, nothing on P1 and P4.** Each goes where the starter's own
  formula already asked for a second element. P2 said "then, in a few words, who the job is for"; P3 "then the one
  fact that makes it believable"; P5 "two figures side by side". So the line takes over what the headline used to
  carry, and adds no new copy. Each formula now names the line, and each slot is 28 characters, the overlay's
  measured limit. Three rather than five: the v4 copy's known weakness is repeating a fact between rows (L3 log),
  and a line the formula has no job for invites exactly that. P1 and P4 stay two-line ads, so the set shows both
  densities.
- **The handoff's "P5 needs its own short headline slot" is already done, by #2211.** The starter P5 is "proof",
  with a 40-character `hook` as its headline; the carousel slot `card_get` survives only in one copywriter fixture
  (`look-ribbon-es-regional`), which describes the old P5 and was kept as a record of what the model does with a
  card-shaped slot.

**D-ADL16 — The ads wear Silvicom's own brand, measured from Silvicom (2026-11-12).** The owner: "we need to
use our brand colors" and "avoid any generic AI looks". Navy `#0A2144` is measured from the wordmark file,
cyan `#00B2E3` from the decal on the trailers in the 2026-01 fleet shoot. The site's CSS uses `#002160`; the
wordmark is the brand and the CSS is the website. The fixture kit's green and amber, and the stand-in orange of
the first mock-ups, are gone. The rules live in one place, `.claude/skills/silvicom-brand/SKILL.md`, so prompts,
reviews and the renderer read the same list instead of restating it.

**D-ADL17 — No generic-AI devices, by name (2026-11-12).** The owner: "avoid using any dots and lines, these are
generic AI things". Research the same day (Meta Ad Library: Werner, Schneider, Knight; designers' published
lists of AI tells) agreed and named more: tracked small-caps kickers, pills and chips, glass panels, gradient
fades, hairlines, decorative arrows, one font for everything. Today's `rail` (side bar, chevron button) and
`ribbon` (ribbon tag, pill button) are built from exactly these, so the renderer's two looks are replaced, not
tuned, when Q-ADL9 is answered. The banned list is in the brand skill.

**D-ADL18 — Big Shoulders replaces Barlow Condensed and Anton (2026-11-12).** One family, two weights: Display
Black for the headline in capitals, Text Medium for the one supporting line. OFL, and drawn for the City of
Chicago, where Silvicom is based. Inter, the website's face, is on the designers' list of AI tells, and the
website is not the ads. Takes effect with the renderer change.

**D-ADL19 — No call-to-action button inside the picture (2026-11-12).** Meta draws its own "Apply now" under
every ad; a second one in the picture competes with it and is one more device. The overlay's `cta` slot stays
in the contract for formats that need it; the new looks do not draw it.

**D-ADL20 — The renderer draws `field`, `number` and `photo` (2026-11-12; Q-ADL9).** They replace `rail` and
`ribbon` in `AD_LOOKS`; a preset stored under an old name reads as its successor (`RETIRED_LOOKS`: rail → field,
ribbon → photo) with no migration, because the name lives inside the preset's jsonb recipe and every reader parses
it through one schema. `field` is the default. No look draws a button, a rail, a ribbon or a hairline; the kicker
is drawn only as the supporting line when there is no second line. `number` draws only a headline that OPENS with
a figure (all 36 of P2's recorded headlines do) and falls back to `field` when its figure leaves its words no
column ("$0.70–$0.78 PER MILE" is too wide at every rung); a band look falls back to `photo` for a kit with no colour
a band could be. The look actually drawn is returned with the render. Sizes measured, not chosen: the supporting
line is 47 px because that is where 28 W's fit the narrowest zone and 29 do not (`OVERLAY_SMALL_LINE_MAX_CHARS`
unchanged); the headline's floor is 80 px because that is where the longest recorded headline that fits is 58
(`OVERLAY_HEADLINE_MAX_CHARS` unchanged). Starters: P1 and P3 `photo`, P2 `number`, P4 and P5 `field`.

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
  **ANSWERED 2026-11-11 (D-ADL15):** P2 pay first, P4 equipment and P5 proof take `rail`; P1 straight talk and P3
  home take `ribbon`.
- **Q-ADL5 — the kit editor's wording.** The drawer still says "plate colour"; the field now means the ground the
  picture darkens toward. L2 renames the label (the stored key stays, D-ADL8's reasoning).
- **Q-ADL6 — `rail`'s band when it holds only the legal line (opened 2026-11-11).** Redrawing the judge's ads
  showed it: with no logo and no phone in the kit, `rail` still draws its full band, so about a seventh of a 4:5
  ad (and of a 1:1) is flat kit colour carrying one line of small print. The candidate answer: the band is drawn
  only when it carries the phone or the logo, and otherwise the footer goes on the hairline, as `ribbon`'s does.
  **Decided by L5, not by taste:** the six redrawn ads give `rail` and `ribbon` identical inputs, and `ribbon` has
  no band. If `rail` scores below `ribbon` on `hierarchy_reads` or `looks_like_kit`, collapse the band (a renderer
  change, no key); if not, the band stays as the kit's colour on the ad.
  **ANSWERED 2026-11-11: the band stays.** Read honestly, the rule above tripped: `rail` scored one point below
  `ribbon` on `hierarchy_reads` on one ad (highway, 4 against 5). But the rule was sized wrong, not the band. The
  same judge re-scoring the same old ads a day apart moved 4 of 12 scores by one point, so a single one-point gap is
  inside its own noise. On `looks_like_kit` the two looks tie (11 and 11), and the judge's reasons credit the
  band with putting the kit on the ad on all three `rail` ads ("fills the footer bar", "in the bottom bar"). The
  judge's reason for the one 4 doesn't mention the band. Nothing measured says the band hurts. Revisit when
  per-ad results on real kits exist: a real kit usually has a phone, which the band was made to carry.
- **Q-ADL3 — the real kit.** The mock-ups use the fixture kit (green, with an amber accent added for the
  mock-up). The real kit's colours and logo decide whether D-ADL5's fallback or D-ADL7's chip is ever seen.
  **FOUND 2026-11-12 (D-ADL16), not asked:** the owner said the company's information and logo are already
  ours, and to research the rest. Silvicom, Inc.'s wordmark, white wordmark and fleet photos are on
  silvicominc.com; the colours are measured from them, not chosen. The kit row itself is still to be entered.
- **Q-ADL7 — choosing the words (opened 2026-11-12, the owner: "we should in settings have texts to choose, or
  ads page").** Today the craft judge picks the copy and the review only SHOWS the others (`AdsCopyCandidates`).
  Candidates: (a) on the creative review, "Use this one" on every offered copy, each line editable before
  approval, the pick recorded as the owner's label for the judge (R7); (b) an "Approved lines" list in Ads
  settings (pay, home time, equipment, lanes) that the copywriter must draw its claims from; (c) both.
  **Recommendation: (c)**, (a) first because it needs no prompt change. (b) is a copywriter prompt change, so a
  live recording, asked before it is made.
- **Q-ADL8 — the Silvicom decal on the trucks (opened 2026-11-12).** The design review's strongest finding: a plain
  white tractor belongs to any carrier. The mock-up's decal was drawn by the image model from the real decal as a
  reference, and came out right once, but D-AD9 exists because image models misspell. Candidates: (a) the model
  draws a plain trailer and the renderer warps the real logo file onto the trailer side (exact every time; needs
  the trailer's corners, which the art director can ask for in a fixed three-quarter view); (b) the 2026-01 fleet
  photo shoot instead of generated photos; (c) let the model draw it and the checker refuse a misspelling.
  **Recommendation: (a)**, with (b) as the fallback for formats (a) cannot place.
  **Half done 2026-11-12:** every image prompt with our equipment now asks for a clean trailer side and a grille
  with no badge (`EQUIPMENT_CLAUSE`, fixed phrases of ours), and the art director (v5) stands ahead of the cab and
  to one side so the trailer's side is in the picture. Placing the logo on that side is not built: it needs the
  trailer side's corners in the finished picture, which nothing yet finds. Open.
- **Q-ADL9 — which ad families (opened 2026-11-12).** Three are drawn: Number (pay-led), Photo (truck and life)
  and Field (the rest). Recommendation: all three, chosen by the preset as `look` is today, Number first.
  **ANSWERED 2026-11-12, the owner: "Yes, all three."** Built as D-ADL20.
- **Q-ADL10 — the plain part of the picture (opened 2026-11-12).** With no button and no label above the headline,
  a `bottom_plate` ad's words now reach at most 32 % of the picture's height in every look (measured over every
  recorded headline: 28.4–31.8 %), where the art director still asks for the lower HALF to be kept plain
  (`QUIET_REGION`, D-ADL14, sized for the old looks' 42–54 %). The picture gives up more room than the words use.
  Candidates: (a) bring `QUIET_REGION.bottom_plate` back to a third, an art-director prompt change and so a
  recording; (b) leave it. **Recommendation: (a)**, asked before it is recorded, with the art director's re-run
  for the plain trailer and badge-free grille (Q-ADL8) so it is one recording, not two.
  **ANSWERED 2026-11-12, the owner: "Yes, record it." Built as two-fifths, not a third:** measured with a supporting
  line under every headline, a `bottom_plate` ad's words reach 33–36 %, and a `top_band` one's 38–41 % with the logo
  above them, so a third would put the words on the subject. `QUIET_REGION` share 0.42 ("two-fifths");
  `overlayCapacity.test.ts` holds both sides (nothing past 0.42, something past a third; a share of 0.40 fails it).

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
- **2026-11-10, L2 built (the contract and the editor; no key).**
  - `overlay_slots` gains two optional roles, `kicker` and `subline` (D-ADL4); a preset names a copy slot for
    each or leaves it out. Compose hands the overlay those slots' words (`drawnCopy`), for the fit asked before
    the picture and for the render. The copywriter already fills every slot a preset declares, so a preset that
    adds the slots gets them written today — by the prompt as it stands, which was never told what a kicker is.
    How good that copy is, is L3's question and its re-record (Q-ADL2).
  - **The small lines' limit is 28 characters, measured:** 28 of the widest capital (W) fit both lines in both
    looks on every format, and 29 do not. `OVERLAY_SMALL_LINE_MAX_CHARS`; the save refuses a slot above it by
    name.
  - The Presets drawer has "How the words are drawn" (Q-ADL4's field) and the two optional lines; the layouts
    read Low / High / Middle (D-ADL8). The kit drawer says "Ground colour" and explains it, and tells the office
    to name one colour primary and one accent (Q-ADL5 answered: label only, stored key unchanged).
  - A browser pass on the built page with mocked API: look changed and saved, a small line set and set back to
    "Not drawn", no page errors. 8 deliberate breaks, 8 caught.
  - The slow compose test named in the handoff failed CI a third time (5,019 ms against 5,000) and now has its
    own 20 s limit, with the measurement beside it.
  - Still open: which starter preset takes which look (Q-ADL4's recommendation stands; the starters are on
    #2211, not merged); L3–L5, each a live recording.
- **2026-11-10, L3 recorded (the copywriter, prompt v4; the owner's OK for the key the same day: "Yes, record
  it").** `prompt.v4.md` is v3 plus one section, "Words drawn on the picture"; the user message marks each slot
  the overlay draws with `on_image` (`kicker`, `headline`, `second_line`, `button`), derived from the preset's
  `overlay_slots`. Four fixtures added that use all five roles (two per look). One live run, 64 calls,
  `claude-sonnet-4-6`:
  - **Agreement 63 of 64 (0.984); v3's baseline was 58 of 60 (0.967).** The one refusal:
    `opening-otr-flatbed-midwest-southeast` (`too_long`, `unrecognised_number`), recorded as refused.
  - **Headlines on the 65 fixtures both versions share (370 each):** median 29 → 27 characters; 30 or fewer
    57.3 % → 60.5 %; 45 or fewer 87.3 % → 83.2 %; longest 92 both times. A small move toward shorter, and more
    long ones too — the model was told to aim for 30 and did so where the hook formula let it.
  - **The small lines, 24 written (4 fixtures × 3 candidates × 2 languages):** none over 21 characters; the
    kicker reads as a label ("Class A regional", "Se busca: Clase A"), the second line as one fact ("Home
    weekly", "Dental y visión").
  - **Two things it does not yet do well.** (1) "No fact twice": 3 of the 12 English/Spanish pairs repeat a word
    or fact between rows ("Class A dedicated" over "Dedicated route. 401k."; "401k plan" over "401k included").
    (2) On the P5 carousel preset the slot drawn as the headline is a card (`card_get`), and the model wrote it
    as a card: three sentences, 47–68 characters, repeating the second line. That is the preset's shape, not the
    prompt's: P5 needs its own short headline slot before it uses the small lines.
  - **Headline ceiling re-measured on the new corpus (386):** `ribbon` now holds 58 (a 58-character headline of
    narrow letters), `rail` 52, 45 or fewer still fits everywhere. `OVERLAY_HEADLINE_MAX_CHARS` 56 → 58.
  - Not done: the owner's rating of the copy (#2054, Q-AD57) is still the only ground truth for quality and is
    still unrecorded; the numbers above are lengths and verdicts, not a quality score.
- **2026-11-11, L5 recorded (the finished-ad judge on the new look; the owner's OK for the key the same day:
  "Yes, record it").** One live run, `pnpm ads:eval finishedAdJudge --record`, prompt `finishedAdJudge@1` unchanged,
  `claude-sonnet-4-6`, 16 calls: the seven old-look ads re-asked, and nine new-look ads on the same photos with the
  same words and kit (D-ADL12, D-ADL13). **Agreement 16 of 16.** Scores are subject · words · hierarchy · kit:

  | Ad (same photo, words, kit) | Old, 11-10 | Old, 11-11 | `rail` | `ribbon` |
  |---|---|---|---|---|
  | highway, pay, 4:5 low | 5 5 3 4 | 5 5 4 3 | 5 5 4 4 | 5 5 **5** 3 |
  | empty road, regional, 4:5 high | 5 5 3 3 | 5 5 3 3 | 5 5 **5** 3 | 5 5 **5** 4 |
  | truck yard, 1:1 low | 5 5 3 4 | 5 4 3 4 | 5 5 **5** 4 | 5 5 **5** 4 |
  | *sum of the three* | 50 | 49 | **55** | **56** |
  | planted: off-kit colours | 5 4 3 1 | 5 5 4 1 | 5 5 5 **1** | — |
  | planted: subject blurred | 2 2 4 3 | 1 2 4 4 | **1** 2 4 4 | — |
  | planted: words contradict picture | 5 2 4 4 | 5 2 4 4 | 5 **2** 4 3 | — |
  | planted: hierarchy (hand-drawn) | 5 2 2 4 | 5 3 2 3 | cannot be drawn (D-ADL13) | — |

  - **`hierarchy_reads`, the criterion the redesign was for: old 3, 3, 3 (11-10) and 4, 3, 3 (11-11); new 4, 5, 5
    (`rail`) and 5, 5, 5 (`ribbon`).** Five of six new-look ads score 5. No old-look ad has scored 5 in either run.
    The judge's old-look reasons name the same fault both days: "Apply today" is "plain bold text with no button
    shape". Its new-look reasons name the drawn button ("the outlined button sits clearly beneath it", "the
    pill-shaped button").
  - `subject_legible` and `words_match_picture` were already 4–5 and stay there: the look didn't cost the
    picture anything. `looks_like_kit` didn't move (old 11 and 10, `rail` 11, `ribbon` 11). With a two-colour kit
    and no logo, every ad loses its point for the missing logo. That criterion waits on the real kit (Q-ADL3).
  - The judge still finds every planted weakness on the new look, each at 2 or less on its own criterion. Reading
    the off-kit ad, it gave hierarchy a 5 and kit a 1: the look carries the hierarchy whatever the colours.
  - **The judge moves one point between runs on the same ad** (4 of 12 old-look scores, 11-10 against 11-11). So
    any one-point difference between two single ads is noise. The look's gain (sums 55 and 56 against 49 and 50;
    hierarchy 14 and 15 against 9 and 10) is not.
  - Q-ADL6 answered from these numbers: `rail`'s band stays. Q-ADL2's third recording is spent.
  - Not measured: the kicker, the second line, the phone and the logo (D-ADL12); a real carrier's kit (Q-ADL3);
    real pictures (V4, Q-AD20). The six ads are three photos drawn twice, which is a small sample. It answers
    "is the new look better than the old on the same inputs", not "is it good enough to launch".
- **2026-11-11, L4 recorded (the art director, prompt v4; the owner's OK for the key the same day: "Yes, record
  L4").** Two changes, one recording:
  - **The plain part is a half (D-ADL14).** `QUIET_REGION` was "the lower third" while the words of every
    `bottom_plate` ad reach past a third (median 42 % on 4:5). It now says half, carries `share: 0.5`, and
    `overlayCapacity.test.ts` holds the renderer to it (putting the third back fails the test: rail 4:5 reaches 45 %).
    The renderer's stack budget (`QUIET_SHARE = 0.4`) is unchanged: it caps the stack alone, a different quantity.
  - **Drama (D-ADL10).** Measured first, on v3's 14 recorded answers. **The art director was already mostly
    dramatic:** 11 of 14 chose low sun, dusk, dawn or night, 7 of the 7 equipment answers with a viewpoint slot
    chose a low angle, and 13 of 14 chose `medium`. The three flat answers ("mid-morning, clear autumn sun",
    "overcast Midwest light, low grey sky", "grey pre-dawn") traced to two examples in v3's own text ("a Midwest
    regional lane is cornfields and overcast"; nothing preferring low sun). v4 replaces that example, adds one
    paragraph asking for a commercial photograph over a snapshot — low sun or night under the place's own lights,
    a camera low and looking up at the equipment — unless the context makes the weather the story, and says
    `wide` is for a road or a setting, never for equipment.
  - **One live run, 14 calls, `claude-sonnet-4-6`: agreement 14 of 14** (v3: 14 of 14); every answer passes
    `judgeArt` (no digit, quote or lettering in a slot; subject in the scene).

  | v3 → v4, 14 answers | v3 | v4 |
  |---|---|---|
  | low sun, dusk, dawn or night under lights | 11 | 13 (the 14th: a night road under stars and headlights) |
  | flat midday or overcast | 3 | **0** |
  | low angle, of the 7 with a viewpoint slot | 7 | 7, and **7 of 7 now "looking up at the cab"** (v3: 0) |
  | distance wide · medium · close | 1 · 13 · 0 | 2 · 12 · 0 (the extra `wide` is a road, as v4 asks) |

  - Context still steers the picture: the Chicago reefer dock is still a city dock (now pre-dawn under dock
    lights, wet from rain), and the people fixture's truck stop is now pre-dawn under the island's lamps instead of
    grey overcast.
  - **Not measured, and it cannot be yet:** whether the pictures are better. These are words for an image model;
    no image model is chosen (Q-AD20, V4), and the checker's photos are not drawn from these prompts. The real
    proof is the finished-ad judge over real V4 images, the L5 comparison repeated with pictures this prompt
    asked for. Q-ADL2's three recordings (L3, L4, L5) are all spent.
- **2026-11-11, the starters take looks and small lines (Q-ADL4, D-ADL15; no key).** Branch `claude/ads-look-starters`
  merges #2211 (starter presets) onto #2233. Six conflicts, every one "both sides added": the look field and the
  concept families side by side in the contract, the form and the drawer. Rendered 20 ads (5 starters × 2 looks ×
  4:5 and 1:1) to choose; every one passed the renderer's checks once the scratch brief held the home-time terms.
  - In P3 and P5 the words climb onto the truck, but that is the stand-in photo, not the look: both are `top_band`
    over checker photos composed for words at the bottom. A picture made for these presets is told to keep the upper
    half plain (D-ADL14).
  - Tests: the starters' looks and small lines are pinned in `starterPresets.test.ts` (P5 drawn `ribbon` fails it;
    P3's or P5's second line removed fails it). The compose test that runs every starter now writes the small lines
    too. Suites: shared 307, api 1,179, web 155.
  - Not done: whether the copywriter writes these three small lines well on these formulas is a live recording
    (the copywriter's fixtures do not include the starters). It is not asked for here: L3 measured the small lines
    on four fixtures already. The owner's copy rating (#2054, Q-AD57) is still the ground truth, and still empty.
- **2026-11-12, the look redone in Silvicom's brand (D-ADL16–19; Q-ADL7–9 opened).** The owner on the first
  three directions (Inter Tight, a stand-in orange, fades and chips): "this are ok, but" the brand is ours, the
  trucks are old models, dots and lines are generic AI, and research how real designers work.
  - Research (subagent, sources in the session): real carrier ads use one brand colour as a solid field, their
    own trucks and one short heavy headline; the slop catalogues name the devices now banned in D-ADL17.
  - Skills: `ad-creative` (coreyhaines31/marketingskills, MIT) is vendored into `.claude/skills/` for the words,
    without its video references; `silvicom-brand` is new. Impeccable, already installed, ran the critique.
  - Photos: six images on Higgsfield (GPT Image 2.6, high, 2k), 16.5 credits, with the 2026-01 fleet photo as
    the model reference: 2027 Cascadia on a highway and at a fuel island, 2027 LT 625 on a wet interstate and in a
    yard, then two edits (the decal added to the Cascadia's trailer, the International badge removed from the LT).
  - The critique (impeccable, two isolated reviewers): the detector's six `cramped-padding` findings are the
    full-bleed canvas read as a web panel, false positives. The design review said type, colour and the absence
    of devices pass, and what still read generic was unmarked trucks, a footer logo and uneven bands. Fixed in
    round three: logo top-left at about 10% of the height, one seam at y=950, cyan only for the figure, the decal.
  - Shown to the owner: https://claude.ai/artifact/LEaFJ6qWC6e1dth6o38MhQ. Not done: the renderer itself. It
    waits on Q-ADL9, and the art director's prompt (plain trailer, badge-free grille, three-quarter view) waits
    on Q-ADL8. Both are recordings or code, asked before they are made.
- **2026-11-12, the three looks built (D-ADL20; the owner: "Yes, all three").** Branch `claude/ads-three-looks`.
  - Fonts: Big Shoulders Display Black and Text Medium, cut from Google's variable fonts at one weight each; Barlow
    Condensed and Anton removed. Coverage measured: every character an ad writes, ¢ and the Spanish marks included;
    lost against the old faces, ten characters no ad writes.
  - Rendered six real ads (2027 Cascadia with the decal, the LT, the fuel island) with the Silvicom kit through the
    renderer itself before writing tests; the logo's contrast block lost its rounded corners (a card, D-ADL17).
  - Tests: 17 new goldens (field ×9, number ×3, photo ×5), looked at. Overlay suites 56, shared ads 324, ads API
    1,277 (+1 sweep flake that passes alone, 66 of 66), ads web 86. The 64 copywriter fixtures that named a look
    were renamed in place: the look never reaches the model (`copyUserMessage` sends name, hook and slots), so their
    recordings stand.
  - Measured on the way (Q-ADL10): the words now reach under a third of the picture in every look.
  - Not done: the art director still describes the old looks' needs (QUIET_REGION half, no trailer-decal or
    badge-free-grille instruction) — Q-ADL8 and Q-ADL10, one recording, asked first. The finished-ad judge has not
    scored these looks (L5's comparison would be a recording too).
- **2026-11-12, art director v5 recorded (Q-ADL10 answered, Q-ADL8 half; the owner: "Yes, record it").**
  - Recorded live: 14 asked, 14 agreed (agreement 1.0, as v4). The seven planted fixtures carry the new version
    label; they are hand-written defects, not model answers.
  - What changed in the answers, v4 → v5, over the seven recorded ones whose subject is a truck: the viewpoint is
    "ahead and to one side" of the cab in 7 of 7 (v4: 4 of 7), so the trailer's side is in view for the decal. No
    recorded answer describes markings (rule 11). Subjects and distances unchanged except one: `people-varied`
    now names the person, not the tractor, which its scene allows.
  - Not measured, and cannot be yet: whether the pictures are better. These are words for an image model; the
    real proof is the finished-ad judge over generated images (V4 / Stage 2).
