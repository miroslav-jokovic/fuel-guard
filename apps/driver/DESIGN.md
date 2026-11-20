# Silvicom 360 Driver App Design Contract

This is the implementation contract for the driver app. **Read it before you create or change any UI in
`apps/driver`.** It exists so that a feature added next year looks like it was designed with the
rest, and does not drift toward generic AI-generated mobile UI.

## Where the decisions live

- **Visual 2026** is the current visual world. The owner approved it on 2026-11-20 on the V1 mock.
  - The plan is [`DRIVER-APP-VISUAL-2026-PLAN.md`](../../docs/plans/drivers-app/DRIVER-APP-VISUAL-2026-PLAN.md),
    with decisions D-DV1–D-DV15 and the owner's rulings in §6.1.
  - The mock is [`visual-2026-mock/V1-MOCK.html`](../../docs/plans/drivers-app/visual-2026-mock/V1-MOCK.html).
    **When this file and the mock disagree, the mock shows the intended look and this file says how to build it.**
- **Direction B** ([plan](../../docs/plans/drivers-app/DRIVER-APP-DIRECTION-B-PLAN.md), D-DB1–D-DB18)
  is superseded for colour, type, containers and the tab shell. Its **behavioural** rules and the owner's
  product rulings still hold:
  - the tab set (D-DB14);
  - no tab motion (D-DB11 amendment);
  - the leaderboard (D-DB17, D-DB18);
  - no invented ETA (D-DB8).

  They are restated below wherever they apply.
- The screens move to Visual 2026 one step at a time (plan §5, V3–V9). Until a screen's step lands, the
  screen keeps its Direction B composition, painted in the new colours and type. **New work follows
  this file, not the screen it happens to sit next to.**

## The system in one picture

```
PALETTE  (scripts/gen-driver-roles.mjs)       what a colour IS — the carrier navy, the decal cyan, …
   ↓ generated
ROLES    (src/theme/theme.roles.json)          what a colour DOES — ink, canvas, action, operation-current …
   ↓ generated / derived
CLASSES + NATIVE COLOURS  (global.css, tailwind.config.js, src/theme/colors.ts)

TYPE     (src/theme/typography.ts)             face · size · weight · figures, per variant
   ↓
AppText / textStyle()                          the only way text gets a style

PRIMITIVES (src/components)                    Button, ListRow, Section, Screen …  — built from the above
   ↓
PATTERNS  (this file, "Screen patterns")       how primitives compose into a screen
   ↓
SCREENS   (app/)                               composition only
```

Each layer may use only the layer above it:
- a screen never names a palette colour;
- a component never sets a font size;
- nothing outside `src/theme/` writes a hex value, a `fontFamily` or a `fontWeight`.

The gates refuse each of these (see "Gates").

## Product character

The driver app is an operational tool used by professional drivers in a moving vehicle, in daylight
and at night, with gloves, with intermittent connectivity, and with limited attention. It is calm,
glanceable, explicit and trustworthy. It is not a marketing site, a social feed or a consumer
dashboard. It carries the **carrier's** brand (Silvicom, Inc.: navy wordmark, cyan trailer decal,
Big Shoulders), because drivers know it from the trucks.

## Visual 2026 decisions (owner-approved 2026-11-20)

Each decision below is final. A change is made by adding a new dated line, never by editing an existing one.

- **D-DV1 · Native chrome, custom content.**
  - The operating system draws the tab bar, stack headers, sheets, menus, pickers and switches:
    - Expo Router native tabs and native stack;
    - `@expo/ui` for sheets, pickers, switches and menus.
  - Our design lives in the content: type, colour, the status block, the rows.
  - The custom `TabBar` retires in V3.
- **D-DV2 · Glass belongs to the system.** The OS gives native chrome Liquid Glass on iOS 26 and
  Material 3 on Android. Content never carries glass, blur or gradients (`lint:design`). The single
  exception is controls floating over a map, on iOS 26 only, with a solid fallback. It is not built yet.
- **D-DV3 · The carrier's colours.**
  - Navy `#0A2144`, measured from the wordmark.
  - Cyan `#00B2E3`, measured from the trailer decal.
  - Every neutral is navy-tinted, so the app has no stock grey.
- **D-DV4 · Dark-first.** "Night cab" is the designed state and "Day steel" its daylight twin. The phone's
  setting chooses between them by default, and Settings → Theme overrides it.
- **D-DV5 · Colour has jobs, never decoration.**
  - **Cyan = live** (the current load, the active stop, "sent").
  - **Amber = act** (the one primary action, time-critical state).
  - **Red = stop** (safety, compliance, failure).
  - **Green = done.**
  - Everything else is ink on a neutral ground.
  - Status colours sit outside the brand's two-colour rule by owner ruling Q-DV2, and only as state.
- **D-DV6 · One signature per screen.** At most one raised block per screen carries what the screen is
  about:
  - Today: the current stop with its appointment window.
  - Documents: what is still missing.
  - Stop: the map strip.
  - Loads and Load detail: none; the figures in the rows carry them.
- **D-DV7 · No cards around rows.**
  - Lists are rows on the canvas, grouped by space and a section label.
  - A raised surface is reserved for the signature block and for sheets.
  - Never a card inside a card.
- **D-DV8 · Two faces.**
  - The platform face (SF Pro / Roboto) for words and for every figure that aligns with another.
  - **Big Shoulders Display** only for a screen title and a screen's lone hero figure.
  - Direction B's single-face rule (D-DB3) retires.
- **D-DV9 · Text scales.** Every variant follows the phone's text size. Layouts wrap, grow or stack. A time,
  unit number or stop name never truncates. `allowFontScaling={false}` is allowed only on badge counts.
- **D-DV10 · Glove targets.**
  - The primary action is at least 56pt tall and sits in the bottom third of the screen.
  - Rows are at least 56pt.
  - Every other control is at least 48pt.
- **D-DV11 · Platform icons.** SF Symbols on iOS and Material Symbols on Android, through `Icon`.
  HugeIcons retire as screens move.
- **D-DV12 · Motion only says something happened.**
  - A haptic plus one short fade or slide confirms a scan, a send or a completed stop.
  - No tab motion.
  - No bounce.
  - Reduce Motion is honoured.
- **D-DV13 · Honest figures only.**
  - No ETA and no "miles left" while no routing service is reachable.
  - "Window opens in 18 min" counts down to a real appointment time and is allowed.
  - "Tight" waits for the feature plan (Q-DV4).
- **D-DV14 · Banned devices**:
  - purple or indigo gradients;
  - glass on content;
  - glow;
  - gradient text;
  - emoji;
  - "Welcome back, Name";
  - decorative pills or chips;
  - a hairline between everything;
  - tracked small-caps kicker labels;
  - a FAB;
  - a five-tab bar;
  - stacks of white rounded cards;
  - ring charts;
  - photos of people.
- **D-DV15 · Tabular figures need the platform face.** Neither Big Shoulders nor Lexend has `tnum`; this
  was measured with fontTools on 2026-11-20. So a figure that lines up with another figure is the
  platform face, and Big Shoulders is used only for a figure that stands alone.

**Product rulings carried forward:**
- **Tabs.** Home · Loads · Documents · More (D-DB14). Loads and Documents may be turned off per fleet; Home
  and More are never conditional.
- **Score** is read from More and summarised on Home.
- **Leaderboard.** "Top five plus me" (D-DB18).
- **Duty.** Duty lives on Today, never in More.
- **Failed syncs.** A failed sync is a list of records, each with its own retry.

## Colour

### Adding or changing a colour

1. Is it a new **job**? Then it is a new ROLE: add a row to `ROLES` in `scripts/gen-driver-roles.mjs`
   naming a palette colour for each of the four appearances.
2. Is it a new **colour**? Add it to `PALETTE`, with a comment saying where it comes from. A palette
   colour no role uses fails `tests/theme-roles-generated.test.ts`.
3. Run `pnpm --filter @silvicom/driver gen:roles`. This writes `theme.roles.json` and then `global.css`.
4. `tests/theme-colors.test.ts` and `tests/tone-pairings.test.ts` measure every promised pairing in all
   four appearances. If a pairing fails, change the value, never the threshold.

Never hand-edit `theme.roles.json` or `global.css`: a test fails on any difference from the generator's output.

### What each role means now

Role **names** are unchanged from Direction B, so every screen re-valued without an edit. Their
**meanings** follow D-DV5. The values are in the generator, never copied here (a copied value table is
how the old version of this file came to describe a palette the app no longer had).

| Roles | Means | Note |
|---|---|---|
| `canvas`, `surface*` | grounds | `surface-raised` is for the signature block and sheets only (D-DV7) |
| `ink`, `ink-secondary`, `ink-muted` | text | `ink-subtle` = `ink-muted`; `ink-disabled` only for disabled controls |
| `edge*` | rare separators, input borders | separate by space first (D-DV7) |
| `hero`, `hero-*`, `on-hero*` | the navy **status block** (D-DV6) | white on navy; `on-hero-muted` only for non-essential copy |
| `action`, `action-fg`, `action-pressed` | **amber = act** fill | `action-fg` is the navy text on it; one per screen |
| `action-ink`, `warning`, `caution`, `sync-pending` | amber as text | "expires in 26 days", "Take" |
| `accent`, `accent-ink`, `accent-soft`, `info`, `operation-current`, `surface-selected`, `edge-focus` | **cyan = live** | was Direction B's lavender |
| `danger*`, `operation-blocked`, `sync-failed` | **red = stop** | |
| `success*`, `operation-complete` | **green = done** | |
| `brand`, `brand-*` | navy ink on day; mist on night | the brand on the night is the navy block, not navy text |

Text on an amber or cyan fill is navy (`action-fg`), in every appearance.

## Type

All type comes from `src/theme/typography.ts` through `AppText`'s `variant` and `weight`. A
`TextInput` that shows a value uses `textStyle()` from the same file (see `Input` and `NumericField`).
No font class, `fontFamily`, `fontWeight` or `fontSize` exists anywhere else.

| Variant | Face | Size / line | Default weight | Use |
|---|---|---|---|---|
| caption | platform | 13 / 18 | regular | timestamps, helper text |
| label | platform | 13 / 18 | semibold | **section labels** ("Rest of the day"), sentence case |
| supporting | platform | 15 / 20 | regular | the second line of a row |
| body | platform | 17 / 24 | regular | prose, input text |
| rowTitle | platform | 17 / 22 | semibold | the first line of a row |
| action | platform | 17 / 22 | semibold | button labels |
| navigationTitle | platform | 17 / 22 | semibold | header titles, sheet headings |
| numericInline | platform, **tabular** | 22 / 28 | semibold | times, windows and values in rows and timelines |
| numericCompact | platform, **tabular** | 26 / 32 | semibold | a score, a count beside its label, entered numbers |
| screenTitle | **Big Shoulders Display**, uppercase | 38 / 38 | ExtraBold | the tab screen's title |
| numericHero | **Big Shoulders Display** | 64 / 60 | ExtraBold | the screen's ONE lone figure (06:00, "2") |

- **Weight.** `weight="regular|medium|semibold|bold"` is the only way to change weight, and it applies
  only to the platform face. Bold Text steps every weight up one, and the display face switches to its
  Black cut.
- **Tabular figures.** `tabular` forces tabular digits on a platform variant. The numeric platform
  variants are tabular by definition.
- **The display face.** These are static 800 and 900 instances of the Google Fonts variable font, bundled
  in `assets/fonts/` with their OFL licence. The provenance is in `typography.ts`.

## Layout, space, targets

- **Grid.** Base quantum is 4pt; `space` and `layout` are in `src/theme/tokens.ts`. Screen inset 20pt,
  section gap 24pt, related gap 12pt.
- **Radii.** 12 (inputs), 16 (tiles, thumbnails), 24 (the signature block), 28 (sheets), pill (buttons).
  There is no fifth radius.
- **Targets (D-DV10).** Primary action 56pt; rows 56pt; every other control 48pt, never under 44pt.
- **Primary action placement.** The one primary action sits in the bottom third: a pinned footer on a
  pushed screen, or the next-step block on Today.
- **Wide screens.** On a display 600pt or wider, content is centred in a 560pt column.
- **Shadows.** Only from `src/theme/elevation.ts`.
- **Density.** Dense means less chrome, not smaller type. Every region answers a driver question, states
  something, or enables an action; if it does none of these, remove it.
- **No arbitrary values.** If a value is not on the scale, first ask whether this is a new pattern. Do not
  add a one-off.

## Screen patterns (from the approved V1 mock)

These are the building blocks a new feature composes from. The **"Built in"** column says which plan
step makes each one a primitive. Before that step, compose it from `AppText`, `Section`, `ListRow` and
`Button` exactly as the mock draws it, and leave a comment naming the step.

| Pattern | Mock screen | Anatomy | Built in |
|---|---|---|---|
| **Status block** (signature) | Today, Documents | Navy block, 24 radius. A context line (`supporting`, `onHeroSecondary`), the subject (`navigationTitle`, `onHero`), ONE lone figure (`numericHero`), then a live line in cyan | V4 `StatusBlock` |
| **Next step** | Today | One surface row: what to do and why, with the amber action on the right (48pt). One per screen, and only when there IS a next step | V4 |
| **Grouped rows** | Today, Loads, More | `label` section heading, then rows on the canvas with no card around them. Leading glyph tinted by state only. Trailing figure `numericInline` or a trailing action word in its state colour | V4 `ListRow` |
| **Time groups** | Loads | Sections by time (Now, Next, Delivered), not by status. The appointment is the trailing figure | V6 |
| **Timeline** | Load detail | Stops on a 2pt rail: cyan dot = current, green = done, hollow = ahead. Window figure largest in each stop. Required photos in words | V6 |
| **Map strip** | Stop | Fixed-height map at the top; floating controls are the only glass (D-DV2). No ETA. Actions in a pinned footer: secondary outlined + amber primary | V6 |
| **Review queue** | Documents | Status block with the count, then the missing items first, then verdicts, then what was sent. Each status a word in its colour, never a pill | V7 |
| **Settings list** | More | Native grouped rows (`@expo/ui` List). No avatar photo, no icon discs | V8 |
| **Pinned primary** | Load detail, pre-shift Today | One 56pt amber button above the tab bar or the home indicator | V4 `ActionBar` |

The tab shell is not a pattern you compose. It is the OS's own (D-DV1, V3).

### Building a new screen

1. Name the driver's question the screen answers. That question decides the signature, if the screen
   has one.
2. Pick the patterns above. If none fits, write down why before inventing a new one, and add it to the
   table in the same PR.
3. Compose from the primitives in `src/components`. Screens contain composition only. Every rule that
   decides content is a pure, tested function in a `*Model.ts` file (see `screens/today/todayModel.ts`).
4. Give the screen every state it can be in: loading (a skeleton only when nothing is cached), empty,
   error, offline, and large text.
5. Add a realistic example to `app/gallery.tsx` if you made or changed a primitive.
6. Take screenshots of light and dark at default and largest text size, and compare them with the V1 mock.

## Component rules

- **Use existing primitives first** (`src/components`):
  - layout: `Screen`, `ScreenHeader`, `Section`, `SectionLabel`, `GroupedList`, `ListRow`, `ActionBar`;
  - text: `AppText`;
  - actions: `Button`, `IconButton`, `ConfirmSheet`, `ChoiceSheet`;
  - forms: `Field`, `Input`, `NumericField`;
  - feedback: `Banner`, `Toast`/`useToast`, `OfflineBanner`, `SyncStatus`;
  - progress: `Progress`, `TaskStepper`;
  - data: `Sparkline`, `TrendChart`;
  - state: `Skeleton`, `EmptyState`;
  - choice: `SegmentedControl`, `ToggleRow`.
- **Do not use these on new work:**
  - `Card`'s generic use: rows are not carded (D-DV7);
  - `Badge` as decoration: a status is a word in its colour;
  - `ListRow`'s tinted discs (D-DB6);
  - `HeroBackdrop`'s wash.

  They remain only until their screens move (V4–V8).
- **Extend or create.** Extend a primitive when the anatomy and behaviour are the same. Create one only when an
  existing primitive cannot express the case without becoming confusing.
- **What every new reusable component must state:**
  - its one user problem;
  - its anatomy;
  - its approved variants;
  - its states (rest, pressed, focused, disabled, loading, empty, error, selected);
  - its light and dark behaviour;
  - its accessibility role, label, state and target;
  - its offline behaviour;
  - a gallery example.
- **No escape-hatch variants.** Never add a variant that accepts arbitrary styling. A variant encodes an
  approved decision.

## Accessibility and state

- **Text.** Use `AppText`, never raw `Text`. Every icon-only control has a label. Every interactive element
  exposes its role and its disabled, busy or selected state.
- **Never colour alone.** Status is text plus icon plus tone.
- **Platform settings.** Reduce Motion, Bold Text and high contrast are honoured through `ThemeProvider`.
  Primitives do not run their own platform checks.
- **Cached data first.** Prefer cached data to a blank screen. A skeleton appears only when nothing usable
  is cached.
- **Offline is normal.** Say what was saved and what will sync later. Never swallow a failed write
  silently.
- **Haptics.** Only for selection, success, warning or destructive confirmation.

## Gates (what refuses work that breaks the system)

| Gate | Refuses |
|---|---|
| `lint:tokens` | raw hex, Tailwind palette classes, inline colour styles outside `src/theme`; `theme.roles.json` differing from the palette generator; `global.css` drift |
| `lint:design` | font classes of any kind, `fontFamily`/`fontWeight`/`fontSize`/`lineHeight`/`letterSpacing` in a style outside `src/theme`, banned faces, `uppercase`/`tracking-*`, emoji, glass/blur/gradient modules, raw `Text`, native `Alert`, arbitrary sizes, `shadowColor` outside the theme, colour classes on `AppText` |
| `test` | every promised contrast pairing in four appearances, the role parity with the palette, the type system (`tests/typography.test.ts`), the elevation step |

Run `pnpm --filter @silvicom/driver typecheck lint lint:tokens lint:design test` before every push. CI runs all of them.

## AI implementation protocol

Before writing UI:
1. Read this file and open the V1 mock.
2. Name the pattern(s) you are using from "Screen patterns".
3. State which primitives you reuse and any new decision you need, and why the system cannot already
   express it.
4. Build the states and accessibility before the polish.
5. Run the gates.

Reject generated UI that contains any of the following:
- a colour, face, icon set, radius, shadow or spacing outside this system;
- any D-DV14 banned device;
- a card around rows;
- a second primary action;
- an invented figure;
- a duplicate primitive;
- placeholder copy or generic SaaS language.

## Definition of done

A driver UI change is done when:
- it uses only the system above;
- it is correct in dark, light, offline, empty, error and largest-text states;
- it matches the V1 mock's patterns;
- all gates pass;
- the owner has seen a screenshot of any screen step before it merges (plan §4).
