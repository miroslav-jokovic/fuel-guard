<script setup lang="ts">
import { computed } from "vue";
import {
  NAV_SURFACES,
  isEditableSurface,
  type ModuleSet,
  type SectionClaim,
  type SurfaceClaim,
  type UserRole,
} from "@silvicom/shared";
import { AppIcon } from "@silvicom/ui";
import { buildNavGroups, type NavItem } from "@/lib/nav";

/**
 * What this principal actually sees, built by the function that builds the real sidebar.
 *
 * ⚠ `buildNavGroups` and not a list of our own. It is the same call `AppShell` makes, with the same
 * arguments, so this preview cannot become a second opinion about the product's navigation — which
 * is the one thing a permissions page must never be. Since S1 it folds over the surface catalogue,
 * so a screen added anywhere appears here without this component learning about it.
 *
 * ── DRAWN AS A SIDEBAR, WITH THE MISSING ITEMS STILL VISIBLE ──────────────────────────────────
 * It used to be three columns of boxes. A sidebar is a column, so the preview is one, in the
 * navigation surface the real one uses. And it is built TWICE — once with the principal's answers
 * and once with the shipped matrix and no overrides — so an item this organisation has taken away
 * can be drawn struck through rather than silently absent: "what changed" is the question an admin
 * is asking, and an absence cannot answer it.
 *
 * Counts are deliberately not passed. A badge is a live number, not a permission, and a zero beside
 * "Hazmat review" would read as "this item is hidden" to exactly the reader this page is for.
 */
const props = defineProps<{
  role: UserRole | null;
  sections: SectionClaim | null;
  surfaces: SurfaceClaim | null;
  modules: ModuleSet | null;
}>();

interface PreviewItem extends NavItem {
  visible: boolean;
}
interface PreviewGroup {
  label: string | null;
  items: PreviewItem[];
}

const groups = computed<PreviewGroup[]>(() => {
  if (!props.role) return [];
  const now = buildNavGroups(props.role, props.modules, {}, props.sections, props.surfaces);
  const shipped = buildNavGroups(props.role, props.modules, {}, null, null);
  const labels = [...new Set([...shipped, ...now].map((g) => g.label))];
  return labels
    .map((label) => {
      const current = now.find((g) => g.label === label)?.items ?? [];
      const baseline = shipped.find((g) => g.label === label)?.items ?? [];
      const seen = new Set<string>();
      const items: PreviewItem[] = [];
      for (const item of [...baseline, ...current]) {
        if (seen.has(item.to)) continue;
        seen.add(item.to);
        items.push({ ...item, visible: current.some((c) => c.to === item.to) });
      }
      return { label, items };
    })
    .filter((g) => g.items.length > 0);
});

const hiddenCount = computed(() =>
  groups.value.reduce((n, g) => n + g.items.filter((i) => !i.visible).length, 0),
);

/**
 * The screens no org may take away (Q-SURF3, owner's ruling). They render above as part of the
 * sidebar, because a reader has to see the whole thing — and they are named here so their absence
 * from the controls reads as a rule rather than as an oversight. Derived from the catalogue's own
 * gate, so a screen that gains a section gate later stops being listed without anyone editing this.
 */
const alwaysOn = computed(() =>
  NAV_SURFACES.filter((s) => !isEditableSurface(s))
    .map((s) => s.label)
    .join(", "),
);
</script>

<template>
  <div>
    <p v-if="!role" class="text-sm text-ink-muted">Pick someone to see their sidebar.</p>
    <template v-else>
      <nav aria-label="Sidebar preview" class="rounded-surface bg-surface-navigation p-2 ring-1 ring-edge-subtle">
        <template v-for="g in groups" :key="g.label ?? '_top'">
          <p v-if="g.label" class="mt-3 px-2 text-2xs font-semibold tracking-wide text-ink-tertiary uppercase">
            {{ g.label }}
          </p>
          <ul class="flex flex-col gap-y-0.5">
            <li
              v-for="i in g.items"
              :key="i.to"
              class="flex min-h-8 items-center gap-x-2 rounded-control px-2 text-sm"
              :class="i.visible ? 'text-ink-secondary' : 'text-ink-tertiary line-through'"
            >
              <AppIcon :icon="i.icon" class="size-4 shrink-0" aria-hidden="true" />
              <span class="truncate">{{ i.name }}</span>
              <span v-if="!i.visible" class="sr-only">(hidden)</span>
            </li>
          </ul>
        </template>
      </nav>
      <p class="mt-3 text-xs text-ink-muted">
        <template v-if="hiddenCount > 0">Struck items are hidden by this organisation's answers. </template>
        Always available to office roles, and not an organisation's to change: {{ alwaysOn }}.
      </p>
    </template>
  </div>
</template>
