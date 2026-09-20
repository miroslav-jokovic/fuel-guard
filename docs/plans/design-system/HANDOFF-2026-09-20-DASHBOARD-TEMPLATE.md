# Handoff — dashboard template v2 → design system, 2026-09-20

**Read this, then `DASHBOARD-TEMPLATE-V2.md` beside it.** That plan is the decision log (D-DT1…
D-DT19, port plan T1–T13, open questions Q-DT1…Q-DT7) and **§10 is its progress log** — what
actually happened, dated, with the measurements. This file is only "where the work stopped" and the
traps worth not paying for twice.

---

## State

Two tranches are on `main`:

- **Tranche 1** — F1 (chip tone vocabulary) and F3 (`lint:tokens` gradient stops). PR #920, merge
  `3d4999f`; docs corrected in #921, merge `ada75ca`.
- **Tranche 2** — **F2, F4, T4, T10, T12**, on `claude/design-system-segmented-well`.

> ⚠ Describe what is IN MAIN and let `git log` carry the rest. The first version of this file said
> "Committed: NO" and was committed inside the very PR that made it false.

The working tree also carries untracked files that are the user's, not this work's
(`docs/Kowlage-Base/`, `docs/design examples/*.png`, a modification to `docs/plans/mcleod/mail.md`).
They have been left alone through three sessions; leave them alone.

## The artifact

`prototypes/dashboard-v2.html` — an interactive prototype of the whole redesign, built against the
product's own token sheet. **Serve from the REPO ROOT** or the tokens and fonts 404:

```bash
npx http-server -p 8080 .
open http://localhost:8080/docs/plans/design-system/prototypes/dashboard-v2.html
```

To see what has SHIPPED, build the app instead: `pnpm --filter @silvicom/web preview:local`, then
`/__design-system`. It is the only route that renders production primitives without a login, and it
now carries the tab strip, the segmented control and all seven chips at both sizes. ⚠ Take the port
number from the END of the log — the script walks up from 4173 and another session's server is
usually already there.

## Next, in order

| # | Work | Notes |
|---|---|---|
| **T5/T6** | Trend readout + nice axis steps in `lib/chartTheme.ts` | D-DT11's readout-as-tooltip and D-DT12's measured viewBox. T6 also affects `FleetTrendChart` — check the finance snapshots |
| **T8** | Grid template as span classes | `tabWidgetsLayout.test.ts` asserts the current layout; it is the thing that has to change |
| **T2/T3** | Card edge-light, `@container` spark | T2's tint must come from a `--viz-*` role passed in, never a hue |
| **T7** | Donut track ring, centre swap, bi-directional hover | `DonutBreakdown.test.ts` exists; the centre becomes stateful |
| **Q-DT7** | The chip's sizes are not the comps' — 40/24 and 36/20 against a specified 40/21 and 32/17.5 | Its own change, with the two call sites screenshotted before and after. §10 has the measurement |
| **T1** | Delta pill | **blocked on Q-DT4** — three of the four KPI deltas have no data behind them and the fourth can never have any |
| **T11** | Duotone chip glyphs | **blocked on Q-DT5** — the free icon set is stroke-only |

## Traps — read before starting

Each of these cost time in this session and none of them is visible to a gate.

- **Tailwind scans `.vue` only… it did until 2026-09-20.** `@source` in both apps now covers
  `{vue,ts}`. If a class you wrote in a `.ts` file renders as nothing — a transparent background, a
  ring that fell back to `currentColor` — check the glob before you doubt the token.
- **`?raw` on a `.css` file returns an EMPTY STRING under vitest.** It resolves, throws nothing, and
  yields length 0. `?raw` on a `.vue` file works. Every sheet-level assertion therefore lives in
  `lint:ui-contrast` (node), not in a component test. A negative assertion against that empty string
  would have passed vacuously.
- **A `z-index: 0` layer drawn first still covers the page.** CSS paints a positioned descendant
  above an in-flow non-positioned one regardless of document order. The shell wraps the page in one
  positioned element; anything else that adds a page-level layer needs the same.
- **jsdom has no layout.** `offsetLeft`/`offsetWidth` are 0, so anything that measures itself must
  degrade rather than disappear (the pill is opacity-hidden, never `v-if`-hidden — a DOM that
  depends on layout means the markup under test is not the markup that ships), and its tests stub
  the offsets.
- **`import.meta.dirname` works under vitest and `import.meta.url` IS a file URL** — the comment in
  `AppIconChip.test.ts` that said otherwise was wrong and has been corrected. But `pnpm --filter`
  runs with the cwd at the package, so never write a cwd-relative path.
- **Q-DT6 still stands.** `lint:tokens` scans `apps/web/src` only, so every primitive in
  `packages/ui/src` is unlinted for tokens, and its class-only rules read `class="…"` one LINE at a
  time, so multi-line `:class="[…]"` arrays are invisible to it. **If you "fix a gate" and it does
  not fire, feed it a probe before concluding the rule is broken.** That is how `bg-linear-140` was
  found to be reported as an unknown colour role, and how the fix was confirmed not to blind the
  rule to `from-chip-nope-from` on the line beside it.
- **A mock without `meta` is an under-specified router.** vue-router gives every route a `meta`
  object; `PageHeader` now reads it. One page test mocked `useRoute()` without one and threw.
- **The design-system lab page is at 468 of its 500 lines.** Its fixture rows already moved to
  `labSpecimens.ts` once. The next specimen splits the page, not the data.

## Gates

Locally, all green on tranche 2: `lint:tokens` · `lint:ui-contrast` · `lint:ui-adoption` ·
`lint:filesize` · `lint:funcsize` · `lint:boundaries` · `lint:comment-claims` · `lint:codegen` ·
`lint:surfaces` · ESLint · `vue-tsc` on web + ui + admin · web tests 2082 · ui tests 108.

⚠ `pnpm lint` is **not** the gate set, `lint:tokens` is an `apps/web` script
(`pnpm --filter @silvicom/web lint:tokens`), and `git add` a new file BEFORE running the gates —
`lint:comment-claims` cannot see an untracked file, so a gate you believe you have satisfied may
simply not have looked.

⚠ `pnpm --filter @silvicom/web build` needs `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`; they are
in `apps/web/.env` on this machine, and CI's `typecheck-build` is what proves the build.

## House rule that shaped this work

Every claim in the plan and in the new code comments is measured, and tests are proved to fail by
mutation before being trusted. Tranche 2 mutated eight things on purpose: the well back to grey, a
hand-copied pill, a dark chip stop onto the pale ramp (1.78:1, exactly as predicted), a cross-hue
gradient, a misspelt elevation, the spring into a jump, the re-target with its velocity zeroed, and
the backdrop's full-bleed refusal. Every one went red in the assertion that claimed to cover it.

⚠ `cp` the bytes back to revert a mutation — `git checkout --` restores nothing on an untracked path
and discards new tests. And check the mutation actually LANDED: one `python3 .replace()` in this
session matched nothing (the anchor had a trailing comma in the import line, not at the call site),
the suite stayed green, and for a minute that looked like a surviving mutant rather than a no-op.
