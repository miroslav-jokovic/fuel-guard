<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton, AppCard as BaseCard, QueryState } from "@silvicom/ui";
import type { TransponderAssignmentDto, TransponderDto } from "@silvicom/shared";
import KebabMenu from "@/components/KebabMenu.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDateTime } from "@/lib/format";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { useSessionStore } from "@/stores/session";
import TollTagDialog from "./TollTagDialog.vue";
import { useTollTagsQuery } from "./useTollTags";
import { tagLabel, type TollTagAction } from "./tollTagLabel";

/**
 * A truck's toll tags (TOLLS-PER-TRUCK-PLAN.md TL2): the ones on it now, the ones it carried before,
 * and each tag's dated history. Tolls are charged to a truck from exactly these dates (D-TL3), so the
 * history is shown in full, voided entries included and crossed out, because "why did June's tolls
 * move to unit 702" is answered here.
 *
 * Gated on equipment, like the truck's file beside it: whoever can view the truck sees its tags, and
 * whoever keeps its file adds, moves, retires and corrects them.
 */

const props = defineProps<{ vehicleId: string; unitNumber: string }>();

const session = useSessionStore();
const maySee = computed(() => session.canView("equipment"));
const canManage = computed(() => session.can("equipment"));
const { zone } = useOrgTimezone();
const at = (iso: string) => formatDateTime(iso, "—", zone.value);

const id = computed(() => props.vehicleId);
const q = useTollTagsQuery(id);
const onTruck = computed(() => (q.data.value ?? []).filter((t) => t.currentVehicleId === props.vehicleId));
const before = computed(() => (q.data.value ?? []).filter((t) => t.currentVehicleId !== props.vehicleId));

const action = ref<TollTagAction | null>(null);
const open = ref<Set<string>>(new Set());
function toggle(tagId: string) {
  const next = new Set(open.value);
  if (next.has(tagId)) next.delete(tagId);
  else next.add(tagId);
  open.value = next;
}

/** This truck's own live entry for a tag, for "on since". */
const since = (t: TransponderDto) => t.history.find((h) => h.vehicleId === props.vehicleId && h.validTo == null && h.voidedAt == null)?.validFrom ?? null;
/** Where a tag this truck carried before is now, in words. */
function elsewhere(t: TransponderDto): string {
  if (t.retiredAt) return `Retired ${at(t.retiredAt)}`;
  if (!t.currentVehicleId) return "Not on a truck";
  const now = t.history.find((h) => h.vehicleId === t.currentVehicleId && h.validTo == null && h.voidedAt == null);
  return now?.unitNumber ? `Now on unit ${now.unitNumber}` : "Now on another truck";
}
const entryLabel = (h: TransponderAssignmentDto) =>
  `Unit ${h.unitNumber ?? "?"}, ${at(h.validFrom)} to ${h.validTo ? at(h.validTo) : "now"}`;
const voidEntry = (t: TransponderDto, h: TransponderAssignmentDto) => {
  action.value = { kind: "void", tag: t, entryId: h.id, entryLabel: entryLabel(h) };
};
</script>

<template>
  <BaseCard v-if="maySee" data-test="toll-tags-card">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-sm font-semibold text-ink">Toll tags</h2>
      <BaseButton v-if="canManage" size="sm" variant="primary" data-test="toll-tag-add" @click="action = { kind: 'add' }">Add tag</BaseButton>
    </div>
    <QueryState
      compact
      :loading="q.isLoading.value"
      :error="q.isError.value"
      :retrying="q.isFetching.value"
      loading-text="Loading the toll tags…"
      error-text="Could not load the toll tags."
      @retry="q.refetch()"
    >
      <p v-if="(q.data.value ?? []).length === 0" class="mt-3 text-sm text-ink-muted">
        No toll tag is on file for this truck. Its tolls cannot be charged to it until one is.
      </p>
      <ul v-else class="mt-3 divide-y divide-edge-subtle">
        <li v-for="t in [...onTruck, ...before]" :key="t.id" class="py-2" data-test="toll-tag-row">
          <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div class="min-w-0">
              <p class="text-sm font-medium text-ink">
                {{ tagLabel(t) }}
                <span v-if="t.issuer" class="font-normal text-ink-tertiary"> · {{ t.issuer }}</span>
              </p>
              <p class="mt-0.5 text-xs text-ink-tertiary">
                <template v-if="t.currentVehicleId === vehicleId">On this truck since {{ since(t) ? at(since(t)!) : "—" }}</template>
                <template v-else>{{ elsewhere(t) }}</template>
              </p>
            </div>
            <div class="flex items-center gap-2">
              <span v-if="t.retiredAt" :class="[BADGE_BASE, toneClass('neutral')]">Retired</span>
              <BaseButton size="sm" variant="ghost" :aria-expanded="open.has(t.id)" @click="toggle(t.id)">
                {{ open.has(t.id) ? "Hide history" : "History" }}
              </BaseButton>
              <template v-if="canManage && !t.retiredAt">
                <BaseButton size="sm" data-test="toll-tag-move" @click="action = { kind: 'move', tag: t }">Move</BaseButton>
                <KebabMenu>
                  <BaseButton class="kebab-item kebab-item-danger" @click="action = { kind: 'retire', tag: t }">Retire tag…</BaseButton>
                </KebabMenu>
              </template>
            </div>
          </div>
          <ol v-if="open.has(t.id)" class="mt-2 space-y-1 border-l border-edge-subtle pl-3 text-xs" data-test="toll-tag-history">
            <li v-for="h in t.history" :key="h.id" class="flex flex-wrap items-center justify-between gap-2">
              <span :class="h.voidedAt ? 'text-ink-tertiary line-through' : 'text-ink-secondary'">{{ entryLabel(h) }}</span>
              <span v-if="h.voidedAt" class="text-ink-tertiary">Voided: {{ h.voidReason }}</span>
              <BaseButton v-else-if="canManage" size="sm" variant="link" data-test="toll-entry-void" @click="voidEntry(t, h)">This is wrong…</BaseButton>
            </li>
            <li v-if="t.history.length === 0" class="text-ink-tertiary">Never on a truck.</li>
          </ol>
        </li>
      </ul>
    </QueryState>
    <TollTagDialog :action="action" :vehicle-id="vehicleId" :unit-number="unitNumber" @close="action = null" />
  </BaseCard>
</template>
