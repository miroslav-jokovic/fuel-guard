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
import { ref, computed, watch } from "vue";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/vue";
import { useRoute, useRouter } from "vue-router";
import { dayRangeInstants, shiftDay, tabIsWorkspace, todayInZone } from "@silvicom/shared";
import { useSessionStore } from "@/stores/session";
import { downloadReport } from "@/features/reports/download";
import { useToastStore } from "@/stores/toast";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import DateRangeFilter from "@/components/DateRangeFilter.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import { greeting } from "@/lib/greeting";
import TabWidgets from "@/features/dashboard/TabWidgets.vue";
import { visibleTabs, initialTab, showsTabStrip } from "@/features/dashboard/dashboardTabs";

const session = useSessionStore();
const route = useRoute();
const router = useRouter();

// Date range scoping the whole page (YYYY-MM-DD | undefined). Default window: the last 30 days.
const from = ref<string>();
const to = ref<string>();
/*
 * D-PREC6: the default window used to run to TOMORROW. `isoDay` was
 * `d.toISOString().slice(0, 10)` — a UTC day — so after 19:00 Central the last-30-days default
 * ended on the next calendar date and began a day late. That is why the window reproducing the
 * owner's 8.61 MPG on 2026-09-20 was 08/22 – 09/21 rather than 08/21 – 09/20.
 *
 * "Today" is a question about a clock, and the clock this product means is the CARRIER's, never the
 * viewer's — a dispatcher in Chicago and an accountant in Berlin must be shown the same 30 days.
 */
const { zone } = useOrgTimezone();
const range = computed(() => {
  const today = todayInZone(new Date(), zone.value);
  // -30, not -29: the span is left exactly as it was. The audit's finding is the ENDPOINT (this
  // window was 08/22–09/21 instead of 08/21–09/20, both 31 days inclusive), and quietly narrowing
  // the default would move every number on the page for a reason nobody asked for.
  return { from: from.value ?? shiftDay(today, -30), to: to.value ?? today };
});

// ── Which dashboards this caller may see ─────────────────────────────────────────────────────────
/**
 * Read once per mount rather than from a ticking clock (D-DR14). Nobody keeps a dashboard open
 * across the 12:00 boundary and needs the word to change under them, and a timer here would be a
 * re-render every minute of the day for a single adjective.
 */
const greetingLine = computed(() => greeting(new Date(), session.fullName));

const tabs = computed(() => visibleTabs((s) => session.canView(s)));
const tabItems = computed<TabItem[]>(() => tabs.value.map((t) => ({ value: t.key, label: t.label })));
const showsStrip = computed(() => showsTabStrip(tabs.value));
/**
 * Seeded once from the caller's role and the `?tab=` they arrived with, then owned by the strip.
 * A `computed` here would fight the user: picking a tab would be overwritten on the next render.
 */
const activeKey = ref(initialTab(tabs.value, session.role, String(route.query.tab ?? "") || undefined)?.key ?? "");

/**
 * The open tab is written back into `?tab=`, which it never was before D-DR24.
 *
 * ⚠ This is not tidiness. `AppShell` decides whether its outlet is a document or a workspace from
 * the route, and the tab is what that answer depends on now that the live map is the Dispatch tab —
 * so the tab has to be somewhere the ROUTER can read it, before the page has rendered. The URL is
 * that place, it costs nothing, and it fixes a gap that was already there: a reload used to drop the
 * reader back on their role's default tab however long they had been on another one.
 *
 * `replace` and not `push`: switching tabs is not a navigation a Back button should have to undo,
 * and `initialTab` already treats the query as a seed rather than an instruction.
 */
watch(
  activeKey,
  (key) => {
    if (!key || route.query.tab === key) return;
    void router.replace({ query: { ...route.query, tab: key } });
  },
  { immediate: true },
);

/**
 * Is the open tab a workspace (D-DR24)? Asked of the widget catalogue, which is the same answer the
 * route's `fullBleed` predicate gets — one fact, two readers, no chance of a page that is a document
 * inside a shell that has gone edge to edge.
 */
const workspace = computed(() => tabIsWorkspace(activeKey.value));

// Exports
const toast = useToastStore();
const exporting = ref(false);
async function exportReport(path: string, filename: string) {
  exporting.value = true;
  try {
    /*
     * Match the on-screen window exactly. These endpoints filter `fuel_transactions.fueled_at`, a
     * `timestamptz` — so unlike the cards above, this range genuinely IS an instant interval, and
     * the only defensible zone for it is the carrier's (D-PREC5 case 2). Built at the browser's
     * midnight until 2026-09-21, which is how a CSV could hold a different set of fills than the
     * screen it was exported from.
     */
    const { start, endExclusive } = dayRangeInstants(range.value.from, range.value.to, zone.value);
    await downloadReport(
      `${path}?from=${encodeURIComponent(start)}&to=${encodeURIComponent(endExclusive)}`,
      filename,
    );
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
  <!--
    D-DR24: the dashboard is a DOCUMENT on most tabs and a WORKSPACE on the one holding the live map.
    A workspace tab drops the greeting and the page's vertical rhythm and becomes a flex column that
    fills the height `AppShell` gave it, so the map ends at the bottom of the viewport instead of
    starting a scroll. `min-h-0` on the child is what lets it shrink inside that column — without it
    a canvas in a flex parent grows to its content and pushes the strip off screen.
  -->
  <div :class="workspace ? 'flex h-full flex-col gap-4' : 'space-y-6'">
    <!--
      D-DR14/D-DR15: the dashboard greets its reader instead of captioning itself "Dashboard". The
      sidebar already says which page this is and `route.meta.title` still does for the browser tab,
      so the h1 was spending the most prominent line on the page repeating the nav. The plate behind
      it is decorative (`alt=""`) and its contrast over the text zone is measured, not assumed.
    -->
    <!-- ⚠ Not rendered on a workspace tab: the hero plate and the greeting are 200px of scenery in
         front of a surface whose whole complaint was that it is not tall enough. The greeting is a
         property of the DASHBOARD, and on this tab the dashboard is a map. -->
    <PageHeader v-if="!workspace" :title="greetingLine">
      Here's what's happening with your fleet today.
    </PageHeader>

    <!--
      ── THE CONTROL ROW (D-DT20) ────────────────────────────────────────────────────────────────
      One row under the hero holding everything that scopes the page: the tab strip at the left, the
      window and the exports at the right, and — teleported in from `TabWidgets`, which owns it —
      Customize.

      ⚠ These three used to sit in three different places, and the reason they are one row now is
      the reason the page read as amateur. The range picker and Export were `PageHeader`'s actions,
      which puts them in the top-right corner OF THE PHOTOGRAPH; Customize was a right-aligned row
      that `TabWidgets` drew above its grid, which put it squarely on the truck's cab at 1440 (x
      1296, y 340, measured 2026-09-20) where it was unreadable; and the tab strip ran the full
      width between them. Every comp in `docs/design examples/` draws this as one row — tabs left,
      scope right — and none of them puts a control on the plate.

      ⚠ **This row is NOT dropped on a workspace tab, unlike the hero above it.** It carried
      `v-if="!workspace"` until 2026-09-20 and that was a trap, not a saving: the tab strip lives in
      this row, so selecting Dispatch unmounted the only control that could select anything else. An
      admin who opened the live map had no way back to Fleet overview short of editing `?tab=` by
      hand, and Customize went with it — `TabWidgets` teleports into `#dashboard-actions` BY ID, so
      the target vanishing takes the button with it silently.

      The hero's reasoning does not transfer. That is ~200px of decorative plate in front of a
      surface whose whole complaint is height; this is a ~36px row of NAVIGATION, and `min-h-0
      flex-1` on the widgets below already lets the map shrink to fit whatever is above it. The
      controls that genuinely have nothing to say on the map — the range picker and Export — are
      gated on `activeKey === 'fleet'` a few lines down, which is where a per-tab decision belongs.
      Pinned by "keeps the strip after picking the workspace tab, so there is a way back" and
      "keeps the Customize teleport target on the workspace tab" in `DashboardPage.shell.test.ts`.
    -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <AppTabs
        v-if="showsStrip"
        v-model="activeKey"
        :tabs="tabItems"
        label="Dashboard view"
        id-prefix="dashboard"
      />
      <!--
        ⚠ The id is a teleport TARGET (`TabWidgets`), so it is load-bearing markup rather than a
        hook for styling: renaming it moves the Customize button back onto the photograph, silently.
        It is `ml-auto` so the scope controls stay right-aligned when there is no strip to push
        them — a role with one tab gets no strip at all (`showsTabStrip`).
      -->
      <div id="dashboard-actions" class="ml-auto flex flex-wrap items-center gap-2">
        <template v-if="activeKey === 'fleet'">
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
        </template>
      </div>
    </div>

    <!--
      LM9: one renderer over `DASHBOARD_WIDGETS`, not a component per tab. The two hand-written tab
      templates this replaced were two roles' dashboards written out by hand; a new widget is now a
      row of data and a component, and adding one needs no edit here at all.
    -->
    <TabWidgets v-if="activeKey" :tab="activeKey" :range="range" :class="workspace ? 'min-h-0 flex-1' : ''" />
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
