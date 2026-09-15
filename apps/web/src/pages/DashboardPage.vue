<script setup lang="ts">
/**
 * The Dashboard shell. It renders whichever dashboard the caller's SECTION GRANTS allow, and nothing
 * else — every tab's content lives in its own component.
 *
 * LM-T / D-DW6. This page used to be one 488-line screen holding every role's dashboard at once, and
 * it showed fuel spend to everybody, because `surfaces.ts` gates it `ALWAYS` and a dispatcher lands
 * here like anyone else. The fix asked for was "a page per role"; the fix built is one page whose
 * tabs are derived from the matrix, which delivers the same screens and keeps three properties a
 * per-role page would have lost:
 *
 *   · an org that grants `dispatch` to its safety manager gets the tab with no code change;
 *   · the permissions preview page keeps telling the truth about what a role sees;
 *   · an admin sees every tab by PASSING every gate, not by being named in a list.
 *
 * ⚠ There is deliberately no `session.role` test in this file. The role appears once, as an argument
 * to `initialTab`, which decides which tab OPENS — never which tabs exist. `dashboardTabs.ts` carries
 * the reasoning and a test that flips a grant rather than a role.
 */
import { AppButton as BaseButton, AppCard as BaseCard, AppIcon, AppTabs, type TabItem } from "@silvicom/ui";
import { ArrowDownTrayIcon, ChevronDownIcon, CsvIcon, PdfIcon } from "@silvicom/ui/icons";
import { ref, computed } from "vue";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/vue";
import { useRoute } from "vue-router";
import { useSessionStore } from "@/stores/session";
import { downloadReport } from "@/features/reports/download";
import { useToastStore } from "@/stores/toast";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import FleetOverviewTab from "@/features/dashboard/FleetOverviewTab.vue";
import DispatchTab from "@/features/dashboard/DispatchTab.vue";
import { visibleTabs, initialTab, showsTabStrip } from "@/features/dashboard/dashboardTabs";

const session = useSessionStore();
const route = useRoute();

// Date range scoping the whole page (YYYY-MM-DD | undefined). Default window: the last 30 days.
const from = ref<string>();
const to = ref<string>();
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const range = computed(() => {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86400_000);
  return { from: from.value ?? isoDay(start), to: to.value ?? isoDay(end) };
});

// ── Which dashboards this caller may see ─────────────────────────────────────────────────────────
const tabs = computed(() => visibleTabs((s) => session.canView(s)));
const tabItems = computed<TabItem[]>(() => tabs.value.map((t) => ({ value: t.key, label: t.label })));
const showsStrip = computed(() => showsTabStrip(tabs.value));
/**
 * Seeded once from the caller's role and the `?tab=` they arrived with, then owned by the strip.
 * A `computed` here would fight the user: picking a tab would be overwritten on the next render.
 */
const activeKey = ref(initialTab(tabs.value, session.role, String(route.query.tab ?? "") || undefined)?.key ?? "");

// Exports
const toast = useToastStore();
const exporting = ref(false);
async function exportReport(path: string, filename: string) {
  exporting.value = true;
  try {
    // Match the on-screen window exactly (the report endpoints read from/to; the old ?days= was ignored).
    const fromIso = new Date(`${range.value.from}T00:00:00`).toISOString();
    const toIso = new Date(`${range.value.to}T23:59:59.999`).toISOString();
    await downloadReport(`${path}?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`, filename);
  } catch (e) {
    toast.error("Export failed", e instanceof Error ? e.message : undefined);
  } finally {
    exporting.value = false;
  }
}
const EXPORTS = [
  { label: "Transactions CSV", description: "Every fill in the selected range", icon: CsvIcon, run: () => exportReport("/api/reports/transactions.csv", "transactions.csv") },
  { label: "Summary PDF", description: "Executive summary of this dashboard", icon: PdfIcon, run: () => exportReport("/api/reports/summary.pdf", "summary.pdf") },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader title="Dashboard">
      <template #actions>
        <div v-if="activeKey === 'fleet'" class="flex flex-wrap items-center gap-3">
          <DateRangeFilter v-model:from="from" v-model:to="to" />

          <Menu v-if="session.can('settings') || session.readOnly" as="div" class="relative">
            <MenuButton
              :disabled="exporting"
              class="inline-flex h-9 items-center gap-1.5 rounded-control bg-surface px-3 text-sm font-medium text-ink-secondary ring-1 ring-edge ring-inset transition hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-50"
            >
              <AppIcon :icon="ArrowDownTrayIcon" class="size-4" aria-hidden="true" />
              {{ exporting ? "Exporting…" : "Export" }}
              <AppIcon :icon="ChevronDownIcon" class="size-4 text-ink-tertiary" aria-hidden="true" />
            </MenuButton>
            <transition
              enter-active-class="transition duration-100 ease-out"
              enter-from-class="scale-95 opacity-0"
              enter-to-class="scale-100 opacity-100"
              leave-active-class="transition duration-75 ease-in"
              leave-from-class="scale-100 opacity-100"
              leave-to-class="scale-95 opacity-0"
            >
              <MenuItems class="absolute right-0 z-sticky-lead mt-2 w-64 origin-top-right overflow-hidden rounded-control bg-surface py-1 text-sm shadow-overlay focus:outline-none">
                <MenuItem v-for="exp in EXPORTS" :key="exp.label" v-slot="{ active }">
                  <BaseButton
                    type="button"
                    variant="ghost"
                    block
                    :class="[
                      '!h-auto !justify-start !gap-3 !whitespace-normal !rounded-none !px-3 !py-2 !text-left !font-normal',
                      active ? 'bg-surface-subtle' : '',
                    ]"
                    @click="exp.run()"
                  >
                    <AppIcon :icon="exp.icon" class="mt-0.5 size-5 shrink-0 text-ink-tertiary" aria-hidden="true" />
                    <span class="min-w-0">
                      <span class="block font-medium text-ink">{{ exp.label }}</span>
                      <span class="mt-0.5 block text-xs leading-4 text-ink-muted">{{ exp.description }}</span>
                    </span>
                  </BaseButton>
                </MenuItem>
              </MenuItems>
            </transition>
          </Menu>
        </div>
      </template>
    </PageHeader>

    <AppTabs
      v-if="showsStrip"
      v-model="activeKey"
      :tabs="tabItems"
      label="Dashboard view"
      id-prefix="dashboard"
    />

    <FleetOverviewTab v-if="activeKey === 'fleet'" :range="range" />
    <DispatchTab v-else-if="activeKey === 'dispatch'" />
    <!-- Q-LM-T1: a driver holds every section at `none`, so they match no tab. They still reach this
         route, because `surfaces.ts` gates it ALWAYS and the matrix treats the Dashboard as an
         ungated nav item for them. An honest empty state is the answer until somebody decides what a
         driver's dashboard IS — it is emphatically not the fleet's financial one they saw before. -->
    <BaseCard v-else as="section">
      <div class="flex min-h-64 flex-col items-center justify-center gap-2 text-center">
        <h2 class="text-lg font-semibold text-ink">Nothing to show here yet</h2>
        <p class="max-w-md text-sm text-ink-muted">Your account does not have a dashboard view. Use the menu to reach your work.</p>
      </div>
    </BaseCard>
  </div>
</template>
