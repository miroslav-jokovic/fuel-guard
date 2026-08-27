# @silvicom/ui

Shared design-system primitives for the FuelGuard front ends.

## Icons

FuelGuard uses [HugeIcons](https://hugeicons.com) (Stroke Rounded, free tier — MIT) as the single icon system across all apps. Never import `@heroicons/*`, `lucide-*`, `react-icons`, or raw SVGs into feature code.

### Usage

```vue
<script setup lang="ts">
import { AppIcon } from "@silvicom/ui";
import { TruckIcon, CheckCircleIcon } from "@silvicom/ui/icons";
</script>

<template>
  <AppIcon :icon="TruckIcon" class="size-5 text-brand-600" aria-hidden="true" />
  <AppIcon :icon="CheckCircleIcon" class="size-4 text-success-500" aria-hidden="true" />
</template>
```

**Sizing:** Tailwind `size-*` (or `w-* h-*`) drives the SVG box — the wrapper deliberately does *not* pass `size` to the underlying HugeIcons component so CSS always wins.

**Colour:** Icons inherit `currentColor`. Use `text-*` on the tag (or an ancestor).

**Stroke width:** Default `1.5` — the HugeIcons Stroke Rounded shipping value. Override via `:stroke-width` only when a specific visual case demands it (rarely).

### Adding a new icon

1. Find the glyph at [hugeicons.com](https://hugeicons.com) — filter to **Stroke Rounded** and **Free**. Note its export name (e.g. `PackageOpenIcon`).
2. Add a re-export in [`src/icons.ts`](./src/icons.ts) under a stable local name.
3. Import from `@silvicom/ui/icons` at the call site.

The indirection is deliberate: it means a designer can swap a variant in one file rather than editing 300 call sites, and we can upgrade to HugeIcons Pro (all 10 styles) later by swapping the source package here — with no changes to feature code.

### Rules (enforced by review)

- Every icon in the codebase must be re-exported from `src/icons.ts`. No inline `import from "@hugeicons/core-free-icons"` in feature files.
- Never use `<HugeiconsIcon>` directly — always go through `<AppIcon>`.
- Never set inline `size="…"` / `color="…"` props on `<AppIcon>` — use Tailwind classes.

See [ADR-001](../../docs/decisions/ADR-001-hugeicons.md) for the full decision record.
