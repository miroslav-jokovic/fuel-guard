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
 * ── THE CALLER'S OWN ARRANGEMENT IS APPLIED OVER THE TOP (LM10, D-DW3) ───────────────────────────
 * `resolveDashboardLayout` takes the gate-admitted list and narrows and reorders it. It is handed
 * `allowed`, never the catalogue, which is what makes it impossible for a stored key to show a
 * widget the gates refused — the permission decision stays here, in `canReachSurface`, and the
 * arrangement is applied strictly after it.
 *
 * ⚠ While the layout is still loading it is `undefined`, and this file treats that as `null` — the
 * role default. A person who has arranged their tab therefore sees the default for the length of one
 * request before their own order arrives. That is the deliberate half of the trade: the alternative
 * is rendering nothing at all until it lands, and a blank square is the one thing a dashboard must
 * never have (the registry's header makes the same call about lazy components). The query's
 * `staleTime` is Infinity, so it happens once per page load, not per tab switch.
 *
 * ── `data-test` NAMES THE WIDGET, BECAUSE NOTHING ELSE IN THE DOM RELIABLY DOES ──────────────────
 * Which cards a caller got, and in what order, is the entire subject of LM10, and the cards do not
 * agree on how to announce themselves — some render an `h3` title, the hero strip renders none at
 * all. Without a marker a test would have to infer a widget from its contents, which is how one ends
 * up passing because two cards happen to look alike; the first draft of the layout test matched `h2`
 * and captured one card out of nine. Read by `tabWidgetsLayout.test.ts`, in
 * "renders every fleet card in catalogue order when there is no row".
 *
 * ── LAYOUT COMES FROM `span`, AND IS TRANSCRIBED RATHER THAN REDESIGNED ──────────────────────────
 * The fleet tab today is three full-width strips followed by three rows of paired cards. One grid
 * with `lg:col-span-2` on the full-width entries reproduces exactly that, and `dashboardEquivalence`
 * is what proves the elements did not move. A flat stack of nine cards would have been simpler code
 * and a visibly different page.
 */
import { computed, nextTick, onMounted, ref } from "vue";
import { canReachSurface, resolveDashboardLayout, widgetsForTab, type DashboardWidget } from "@silvicom/shared";
import { useSessionStore } from "@/stores/session";
import { useModulesQuery } from "@/composables/useModules";
import { useDashboardLayout } from "@/composables/useDashboardLayout";
import { WIDGET_COMPONENTS, WIDGETS_TAKING_RANGE } from "@/lib/dashboardWidgets";
import { AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import { AdjustmentsHorizontalIcon } from "@silvicom/ui/icons";
import DashboardLayoutEditor from "@/features/dashboard/DashboardLayoutEditor.vue";

const props = defineProps<{
  tab: string;
  /** The window the shell's filter picked. Passed only to widgets that scope by it. */
  range: { from: string; to: string };
}>();

const session = useSessionStore();
const { data: modules } = useModulesQuery();
const { layout } = useDashboardLayout();

const editing = ref(false);

/**
 * Is the page's control row there to teleport Customize into (D-DT20)?
 *
 * Read once on mount rather than per render: the row is `DashboardPage`'s own markup, rendered
 * above this component and for as long as it is, so the answer cannot change while this is
 * mounted. Asked at all because this component is mounted without a page around it in three test
 * files, and a Teleport whose target does not exist warns and renders nothing.
 */
const hasActionsRow = ref(false);
onMounted(async () => {
  /**
   * ⚠ After `nextTick`, and that is not defensive tidiness — it is the difference between the
   * button landing in the row and landing back on the photograph. A child's `onMounted` runs
   * BEFORE its parent's subtree is inserted into the document, so the row exists as a detached
   * node and `document.querySelector` returns null. Measured on 2026-09-20: the first build of
   * this teleport rendered in place, silently, because the guard said the target was missing.
   */
  await nextTick();
  hasActionsRow.value = document.querySelector("#dashboard-actions") !== null;
});

/** Everything on this tab the caller MAY see. The permission answer, and the only one. */
const allowed = computed<DashboardWidget[]>(() =>
  widgetsForTab(props.tab, (w) =>
    canReachSurface(w, session.role, modules.value ?? null, session.sections),
  ),
);

/** …and what they have asked to see, of those, in the order they asked for. */
const widgets = computed<DashboardWidget[]>(() =>
  resolveDashboardLayout(allowed.value, session.role, layout.value ?? null),
);

/** A catalogued key with no component is a blank square, so it is skipped and `lint:surfaces` fails. */
const drawable = computed(() => widgets.value.filter((w) => WIDGET_COMPONENTS[w.key] !== undefined));

/**
 * Nothing to draw, but something they could draw — they have hidden it all, or they hold a role no
 * widget on this tab defaults to (an admin on Dispatch, since `dispatch.live-map` defaults to
 * `dispatcher` alone). Either way the answer is the same and it is not an error: tell them where the
 * switch is. A caller who may see NOTHING on this tab is a different case and is not this one — they
 * never reach a tab whose gate they fail.
 */
const emptyByChoice = computed(() => drawable.value.length === 0 && allowed.value.length > 0);

/**
 * …and NOTHING they could draw, which is a different sentence and must not offer a Customize button.
 *
 * Reachable, and not hypothetically: the Dispatch TAB is gated on the `dispatch` section alone, while
 * `dispatch.live-map` additionally requires the `dispatch` MODULE. An org that has not bought the
 * module, whose user holds the section, passes the tab gate with no widget behind it. Offering to
 * rearrange an empty set there is the sort of small dishonesty that adds up — the drawer would open
 * on no rows and a Save that saves nothing.
 */
const nothingAvailable = computed(() => allowed.value.length === 0);

/**
 * A WORKSPACE tab is one surface filling the tab, not a grid of cards (D-DR24).
 *
 * ⚠ It skips `resolveDashboardLayout` entirely, and that is the point rather than an omission. The
 * per-user layout exists to pair, reorder and hide cards; a tab with one surface on it has nothing to
 * pair it with, and hiding it would leave a tab holding an empty state and no way back — the
 * Customize button that would restore it is the very thing being hidden. So a workspace is not
 * arrangeable and says so here, once, instead of every consumer guarding against a stored key.
 *
 * The GATE still applies: `allowed` is computed above from `canReachSurface` exactly as for a card,
 * so an org without the dispatch module still gets the "nothing to show here" panel.
 */
const workspaceWidget = computed(() =>
  allowed.value.find((w) => w.span === "workspace" && WIDGET_COMPONENTS[w.key] !== undefined),
);
</script>

<template>
  <!-- A workspace IS the tab: no Customize row, no card, no grid, and the height it was given. -->
  <component
    :is="WIDGET_COMPONENTS[workspaceWidget.key]"
    v-if="workspaceWidget"
    :data-test="`widget-${workspaceWidget.key}`"
    class="h-full"
  />

  <div v-else class="space-y-4">
    <!--
      ── WHY THIS IS A TELEPORT (D-DT20) ───────────────────────────────────────────────────────────
      The button belongs on the page's control row, beside the tabs and the range picker; the
      DECISION to offer it belongs here, where `nothingAvailable` is computed and where the editor
      it opens already lives. Teleporting is what lets both be true. The alternatives were both
      worse: emitting "I have widgets" so the page could draw its own button duplicates the gate in
      a second place, and moving the editor up to the page drags `allowed`/`arranged` — the whole
      permission computation — with it.

      Before this it was a right-aligned row of its own directly under the tab strip, which on the
      Dashboard put it on top of the hero photograph: at 1440 it landed on the truck's cab, mid-grey
      on mid-grey, and read as a smudge rather than a control.

      ⚠⚠ `:key` IS THE FIX, and `:disabled` alone was not. Vue resolves a Teleport's target ONCE,
      at the vnode's first mount, and caches it on the vnode — including when it mounts disabled.
      A child's `onMounted` runs before its parent's subtree reaches the document, so the target
      resolved to `null`, and flipping `disabled` afterwards moved the button to nowhere: it stayed
      exactly where the old code drew it, on the photograph, with no warning in a production build.
      Keying on the flag remounts the Teleport once the row is really in the document, which is the
      only moment the target can be resolved. Measured 2026-09-20; two builds read as "the teleport
      silently does nothing" before the cache was the answer.

      `:disabled` still earns its place: it is what the unit tests mount against (three files mount
      this component with no page around it), and it renders the button in place rather than
      dropping it.
    -->
    <Teleport
      v-if="!nothingAvailable"
      :key="String(hasActionsRow)"
      to="#dashboard-actions"
      :disabled="!hasActionsRow"
    >
      <BaseButton type="button" variant="ghost" @click="editing = true">
        <AppIcon :icon="AdjustmentsHorizontalIcon" class="size-4" aria-hidden="true" />
        Customize
      </BaseButton>
    </Teleport>

    <!-- Nothing exists for them here — see `nothingAvailable`. No Customize, because there is
         nothing to customize, and no suggestion that they have done something they can undo. -->
    <div v-if="nothingAvailable" class="flex min-h-64 flex-col items-center justify-center gap-2 rounded-control bg-surface px-6 text-center ring-1 ring-edge ring-inset">
      <h2 class="text-lg font-semibold text-ink">Nothing to show here</h2>
      <p class="max-w-md text-sm text-ink-muted">
        This view has no cards available to your organization yet.
      </p>
    </div>

    <div v-else-if="emptyByChoice" class="flex min-h-64 flex-col items-center justify-center gap-2 rounded-control bg-surface px-6 text-center ring-1 ring-edge ring-inset">
      <h2 class="text-lg font-semibold text-ink">No cards on this tab</h2>
      <p class="max-w-md text-sm text-ink-muted">
        Nothing is turned on here yet. Choose what you want to see, or restore the default.
      </p>
      <BaseButton type="button" variant="secondary" class="mt-2" @click="editing = true">
        Customize
      </BaseButton>
    </div>

    <div v-else class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div
        v-for="w in drawable"
        :key="w.key"
        :data-test="`widget-${w.key}`"
        :class="w.span === 'full' ? 'lg:col-span-2' : ''"
      >
        <component
          :is="WIDGET_COMPONENTS[w.key]"
          v-bind="WIDGETS_TAKING_RANGE.has(w.key) ? { range } : {}"
        />
      </div>
    </div>

    <DashboardLayoutEditor
      :open="editing"
      :offered="allowed"
      :arranged="widgets"
      @close="editing = false"
    />
  </div>
</template>
