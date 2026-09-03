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
import { buildNavGroups } from "@/lib/nav";

/**
 * What this principal actually sees, built by the function that builds the real sidebar.
 *
 * ⚠ `buildNavGroups` and not a list of our own. It is the same call `AppShell` makes, with the same
 * arguments, so this preview cannot become a second opinion about the product's navigation — which
 * is the one thing a permissions page must never be. Since S1 it folds over the surface catalogue,
 * so a screen added anywhere appears here without this component learning about it.
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

const groups = computed(() =>
  props.role ? buildNavGroups(props.role, props.modules, {}, props.sections, props.surfaces) : [],
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
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div v-for="g in groups" :key="g.label ?? 'top'" class="rounded-surface bg-surface-subtle p-3">
          <p class="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {{ g.label ?? "Top level" }}
          </p>
          <ul class="mt-2 space-y-1">
            <li v-for="i in g.items" :key="i.to" class="text-sm text-ink-secondary">{{ i.name }}</li>
          </ul>
        </div>
      </div>
      <p class="mt-3 text-xs text-ink-muted">
        Always available to office roles, and not an organisation's to change: {{ alwaysOn }}.
      </p>
    </template>
  </div>
</template>
