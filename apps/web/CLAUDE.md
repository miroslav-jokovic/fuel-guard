# apps/web — Vue 3 SPA

`docs/DESIGN-SYSTEM-CONTRACT.md` is the canonical design reference — read it before building or
changing UI. The rules below are the ones most often violated; the contract has the full detail.

## Verify with

- `pnpm --filter @fuelguard/web typecheck` (vue-tsc) and `pnpm --filter @fuelguard/web test` (vitest).
  Prefer these over a dev server for verification.
- `pnpm --filter web lint:tokens` after ANY template/style change — raw palette utilities
  (`bg-red-500`), hex colors, and inline color styles all fail the build. Semantic tokens only
  (`text-ink-muted`, `bg-surface`, `ring-edge`).

## Non-negotiables

- One primitive per job, always reused, never re-styled: `DataTable` (inside `BaseCard padding="none"`,
  never wrapped in another card), `FilterBar`, `FilterSelect` (toolbars) vs `ComboSelect` (forms),
  `SlideOver` (actions in `#footer`), `KebabMenu` (children are `BaseButton class="kebab-item"` — a
  raw `<button>` in pages/features fails `lint:ui-adoption`), `FileDropzone`, `StatusBadge`.
- Inside apps/web import `Base*` from `@/components/ui/`; only `AppIcon` comes from `@fuelguard/ui`.
  Never import `@hugeicons/core-free-icons` directly — add to `packages/ui/src/icons.ts` first.
- Every badge is `[BADGE_BASE, toneClass(...)]` from `@/lib/badges` — no local tone maps, no
  status string literals in templates.
- Omit `align` on DataTable columns; `numeric: true` adds tabular-nums only (does NOT right-align).
- Six text sizes only (`text-sm` default, `text-xs`, `text-base`, `text-lg`, `text-2xl`, `text-3xl`);
  headings `font-semibold`; `font-bold` is for KPI numbers; `font-mono` only for machine identifiers.
- Page skeleton: `<div class="space-y-6">` → `PageHeader` (no title — that comes from
  `route.meta.title`) → `FilterBar` → `DataTable` with `TablePagination` in `#footer`.
- Mutation feedback is a toast (`useToastStore`), never an inline banner.
- Data layer: TanStack vue-query composables in `src/composables/`; writes go through the API
  (`apiFetch`), reads may use direct PostgREST where a composable already does. Invalidate by
  key prefix on mutation success.
- Features (`src/features/<name>/`) may not import other features' internals (`lint:boundaries`);
  shared code moves to `@/composables`, `@/components`, `@/lib`, `@/stores`.

## Copy voice

Sentence case; buttons and toast titles take no terminal period; full sentences do. State the fact,
then the next action: "No trailers yet. Add one, or sync from Samsara."
