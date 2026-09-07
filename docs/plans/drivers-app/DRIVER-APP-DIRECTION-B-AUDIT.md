# Direction B — implementation audit

> Status: **B0–B7 built and merged 2026-09-07 (PRs #642–#649). The owner device gate in §3 is OPEN
> and is the only thing between this programme and done.**
>
> Companion to `DRIVER-APP-DIRECTION-B-PLAN.md`. The plan says what was decided; this says what was
> actually built, where it deviated, and what nobody has verified yet.

---

## 1. What shipped

| Step | PR | Substance |
|---|---|---|
| B0 Foundation | #642 | 50 colour roles × 4 appearances, `pnpm gen:theme` + mirror test, Lexend, `numericInline`, radius 12/16/24/28, `elevation.ts` |
| B1 Shell + primitives | #643 | `Screen(hero, flow)`, `Section`, `ToastHost`, `tone.ts`, chip anatomy, row discs, navy tab shell |
| B2 Today | #644 | Four states, attention queue, hero card, week strip; `src/screens/` layer created |
| B3 Loads | #645 | Offer deck, `ChoiceSheet`, rows replace cards, `LoadCard`/`CurrentLoadCard`/`sampleLoads` deleted |
| B4 Detail + Stop | #646 | Itinerary timeline, map hero, photo tiles, completion receipt |
| B5 Score | #647 | Eight-week trend line, sub-score definitions and weights |
| B6 The rest | #648 | One-tap start, per-record sync retry, shift summary, six screens restyled |
| B7 Close | #649 | Bracket escapes closed, `sectionTitle` deleted, dead tab icons removed, DESIGN.md rewritten |

**Tests added:** `today-model` (20), `trend-chart-model` (21), `itinerary-model` (13),
`start-shortcut-model` (11), `offer-deck-model` (8), `theme-css-mirror` (2), plus additions to
`theme-colors`, `score-model`, `duty-format` and `screen-padding`. 262 → 264 total.

**Mutation testing** was run against every new pure module. 20 mutants introduced, **17 died**. The
three survivors are recorded in §4 as equivalent, not as gaps.

---

## 2. Corrections made during the build

Findings that changed the code, in the order they were found.

1. **Seventeen weight utilities went inert the moment Lexend loaded** (B0, follow-on commit). A
   Tailwind weight class does nothing to a loaded custom face — the family IS the weight. Before B0
   those sites sat on the platform face where the utility worked; after it they read as emphasis in
   the source and rendered flat. All seventeen moved to `font-ui-md|sb`, and `lint:design` now bans
   the whole weight scale.
2. **`src/features/today/` was nine `lint:boundaries` violations** (B2). A feature may not import a
   sibling's internals, and Today imports five of them. The gate was right: a module needing duty,
   loads, notifications, messages and score is a composition, not a feature. It became
   `src/screens/today/`, and `src/screens/README.md` writes the layer down. **Root cause:** the
   plan's §4.6 named four root gates out of the ~28 CI runs, and this was not one of them.
3. **The countdown's zero boundary** (B2). At exactly the appointment, `minutes >= 1` reached
   "Window open now" only by accident of the next branch; `>= 0` would have printed "Opens in 0 min"
   with every test green. Found by mutation, now its own test.
4. **The window verdict has to read `arrived_at`** (B4). Judging against `now` turns a stop marked
   arrived at 13:50 for a 14:00 window into a late arrival when the screen is reopened at 16:30.
5. **The trend chart's callout runs off the edge unclamped** (B5). The newest week sits at the right
   edge by construction, so this was not an edge case — it was every render.
6. **The failed-sync labels were nine wrong strings** (B6). Restating the outbox kinds as literals
   produced nine keys that never match, so a driver would have seen `hazmat_capture` on the screen
   they read when something has already gone wrong. Now keyed off the constants.
7. **`completedToday` must compare LOCAL days** (B6). A driver signing off at 22:00 Central on the
   7th is already the 8th in UTC — a UTC comparison shows an empty summary at exactly the moment
   they want to read it.

---

## 3. Owner device gate — **OPEN**

**Nothing in this programme has run on real hardware.** There is no iOS job in CI (macOS runners
bill at ~10× Linux) and no screenshot harness, so every step's "screenshot in the PR" done-when is
unfulfilled. `app/gallery.tsx` was extended at each step as the substitute — it now renders all four
Today states, both driver types on the offer deck, both stop heroes, four trend-chart states, every
chip tone on white and on navy, and both card registers — but a gallery is not a phone in daylight.

The pass to run, per B7:

- [ ] iPhone and Android, **bright daylight** and **night cab**
- [ ] Default text and large text (≥ 1.35 scale)
- [ ] Light, dark, and high-contrast appearances
- [ ] Airplane mode on the stop screen (the flat hero must replace the map, not a grey rectangle)
- [ ] One-tap start with a free truck, and with a colleague holding it
- [ ] An offer deck with two offers, at both driver types
- [ ] Complete a stop and confirm the toast survives the `router.back()`

**The two failures I would expect first**, both with a fallback that costs no component work:

- **Q-DB2 · sunlight legibility of the navy hero.** The hero carries only `on-hero` (≥ 7:1) and
  `on-hero-secondary` (≥ 4.5:1) for essential copy, and high-contrast deepens it to `#0B1830`. If it
  fails outdoors, the fallback is to re-value `hero` / `on-hero*` to the greige alternate from the
  canvas — a `theme.roles.json` change plus `pnpm gen:theme`, nothing else.
- **Amber on navy at low brightness.** `action` `#F4A340` on `hero` `#14263F` is the app's one action
  colour. If it reads hot at night, `action` moves without touching a component.

Log findings below as dated lines, then fix them in `claude/driver-b7-fix-<n>` branches.

### Device findings

_(none yet — the gate has not been run)_

---

## 4. Accepted, not fixed

- **Three equivalent mutants.** `nodeState`'s `skipped`/`completed` check order (a status holds one
  value); `completedToday`'s `isNaN` guard (`Invalid Date` never matches a real day); `smoothPath`'s
  spline control points (the curve still passes through every week — pinning it would freeze a
  drawing decision rather than a rule).
- **No ETA and no remaining distance anywhere** (D-DB8 / Q-DB3). The canvas shows "148 mi ahead" and
  "12 min · 4.8 mi"; `total_miles` is the whole load and no routing service is reachable from this
  app, so both would be invented. Revisit when the navigation programme lands NP1.
- **`app/hazmat/capture.tsx` was never touched** (§4 rule 7). The scanner programme owns it. It uses
  `SectionLabel`, which is now a bare in-card heading and renders correctly.
- **B1.14 large text is partly deferred.** The primitive-level rules are in; the hero card's tile
  stacking and paired-button stacking landed with the compositions in B2–B4. Verify on device.

---

## 5. Open questions still open

`Q-DB1` map tiles in production · `Q-DB2` sunlight (above) · `Q-DB3` ETA · `Q-DB4` notification split
(one screen, as planned) · `Q-DB5` thread↔stop linkage (`load_ref` only, built in B4) ·
`Q-DB6` deck gestures (Accept/Decline only, no swipe).

**§6's P0–P8 production readiness has not started.** P1 (target API 36 + 16 KB) must merge before the
first store build and P4 (account closure) before the first submission.
