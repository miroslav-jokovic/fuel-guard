<script setup lang="ts">
/**
 * One dashboard tab, rendered from the catalogue (LM9, D-DW1).
 *
 * This replaces `FleetOverviewTab.vue` and `DispatchTab.vue`, which were two hand-written templates
 * holding two roles' dashboards. There is now one renderer and a catalogue, so adding a widget is a
 * row of data and a component — never a branch in here, and above all never a `session.role` test.
 *
 * ── THE GATE IS `canReachSurface`, THE SAME CALL THE SIDEBAR MAKES ───────────────────────────────
 * Not a copy of it, not a role list, not `session.canView` inlined per widget. A widget is admitted
 * by exactly the mechanism a sidebar entry and a route guard already are, which is what makes an
 * org's sparse section override work here for free and keeps the permissions preview honest.
 *
 * ── LAYOUT COMES FROM `span`, AND IS TRANSCRIBED RATHER THAN REDESIGNED ──────────────────────────
 * The fleet tab today is three full-width strips followed by three rows of paired cards. One grid
 * with `lg:col-span-2` on the full-width entries reproduces exactly that, and `dashboardEquivalence`
 * is what proves the elements did not move. A flat stack of nine cards would have been simpler code
 * and a visibly different page.
 */
import { computed } from "vue";
import { canReachSurface, widgetsForTab, type DashboardWidget } from "@silvicom/shared";
import { useSessionStore } from "@/stores/session";
import { useModulesQuery } from "@/composables/useModules";
import { WIDGET_COMPONENTS, WIDGETS_TAKING_RANGE } from "@/lib/dashboardWidgets";

const props = defineProps<{
  tab: string;
  /** The window the shell's filter picked. Passed only to widgets that scope by it. */
  range: { from: string; to: string };
}>();

const session = useSessionStore();
const { data: modules } = useModulesQuery();

const widgets = computed<DashboardWidget[]>(() =>
  widgetsForTab(props.tab, (w) =>
    canReachSurface(w, session.role, modules.value ?? null, session.sections),
  ),
);

/** A catalogued key with no component is a blank square, so it is skipped and `lint:surfaces` fails. */
const drawable = computed(() => widgets.value.filter((w) => WIDGET_COMPONENTS[w.key] !== undefined));
</script>

<template>
  <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
    <div
      v-for="w in drawable"
      :key="w.key"
      :class="w.span === 'full' ? 'lg:col-span-2' : ''"
    >
      <component
        :is="WIDGET_COMPONENTS[w.key]"
        v-bind="WIDGETS_TAKING_RANGE.has(w.key) ? { range } : {}"
      />
    </div>
  </div>
</template>
