<script setup lang="ts">
/**
 * Needs action — every alarm on the Operations tab in one list, largest first
 * (SMALL-SCREENS-PLAN.md D-SM12; C2, 2026-11-15).
 *
 * The owner's audit of the tab, 2026-11-14: ten equal cards, 37 rows of one weight, and the few that
 * needed a person had to be found by reading all of them. This card is the reading done: what is
 * wrong, how many, and the door to each — the same figure, the same door and the same computation as
 * the row on its own card (`lib/opsRowSources.ts`), so the two cannot disagree. D-FO1's "every figure
 * once" is about the STATE of the fleet; an alarm repeated here beside its area is the ruling of
 * D-SM12, and the caption names the card it came from.
 *
 * ── EACH ROW IS ADMITTED BY ITS OWN CARD'S GATE (D-FM4) ──────────────────────────────────────────
 * `allowed` is `canReachSurface` over the catalogue — the call `TabWidgets` makes for the cards
 * themselves — so a reader gets here exactly the rows of the cards they may be shown, and a source
 * they may not see is never mounted and never asked. It is the PERMISSION, not the arrangement: a
 * reader who hid the Shop card with Customize still has open defects, and still may see them.
 *
 * It lives in `lib/` because it reads ten features' rows, which only the Dashboard's composition
 * root may name (`lint:boundaries`; the long form is in `opsRowSources.ts`).
 */
import { computed, reactive } from "vue";
import { canReachSurface, widgetsForTab, type DayWindow } from "@silvicom/shared";
import { FlagIcon } from "@silvicom/ui/icons";
import ChartCard from "@/components/ui/ChartCard.vue";
import CountList, { type CountRow } from "@/components/ui/CountList.vue";
import { useSessionStore } from "@/stores/session";
import { useModulesQuery } from "@/composables/useModules";
import { OPS_ROW_SOURCES, OpsRowSourceProbe } from "./opsRowSources";
import { needsAction } from "./opsNeedsAction";

defineProps<{ range: DayWindow }>();

const session = useSessionStore();
const { data: modules } = useModulesQuery();

const allowed = computed(() =>
  widgetsForTab("ops", (w) => canReachSurface(w, session.role, modules.value ?? null, session.sections)).filter(
    (w) => OPS_ROW_SOURCES[w.key] !== undefined,
  ),
);

/** What each mounted source last reported. Read through `allowed`, so a closed gate's rows are dropped. */
const reported = reactive(new Map<string, CountRow[]>());
const result = computed(() =>
  needsAction(allowed.value.map((w) => ({ key: w.key, label: w.label, rows: reported.get(w.key) ?? null }))),
);

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const caption = computed(() => {
  const { rows, clear } = result.value;
  const need = rows.length === 1 ? "thing needs a person" : "things need a person";
  return clear > 0 ? `${need} · ${plural(clear, "check is", "checks are")} clear` : need;
});
</script>

<template>
  <ChartCard
    title="Needs action"
    subtitle="Every alarm on this tab, largest first"
    :icon="FlagIcon"
    tone="danger"
    :readout="result.rows.length.toLocaleString('en-US')"
    :caption="caption"
    class="h-full"
  >
    <OpsRowSourceProbe
      v-for="w in allowed"
      :key="w.key"
      :source="OPS_ROW_SOURCES[w.key]!"
      :range="range"
      @rows="reported.set(w.key, $event)"
    />
    <CountList v-if="result.rows.length > 0" :rows="result.rows" />
    <!-- ui-adoption: server-message — the card's own sentence; "nothing" is said only once every check has answered. -->
    <p v-else-if="result.unknown === 0" class="text-sm text-ink-secondary" data-test="needs-action-clear">
      Nothing needs a person right now.
    </p>
    <p
      v-if="result.unknown > 0"
      class="text-xs text-ink-tertiary"
      :class="result.rows.length > 0 ? 'mt-3 border-t border-edge-subtle pt-3' : ''"
      data-test="needs-action-unknown"
    >
      {{ plural(result.unknown, "check has", "checks have") }} not answered yet.
    </p>
  </ChartCard>
</template>
