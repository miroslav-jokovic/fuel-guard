<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import { TOLL_PROVIDER_LABEL, type TransponderDto } from "@silvicom/shared";
import { AppBadge, AppButton, FactList, type Fact } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { formatDateTime } from "@/lib/format";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { useSessionStore } from "@/stores/session";
import TollTagDialog from "./TollTagDialog.vue";
import TollTagHistory from "./TollTagHistory.vue";
import { tagLabel, type TollTagAction } from "./tollTagLabel";
import { TAG_STATUS_LABEL, TAG_STATUS_TONE, tagSince, tagStatus, tagUnit } from "./tollTagRows";

/**
 * One toll tag, opened from the Tolls page's tag list (TOLLS-PER-TRUCK-PLAN.md TL2b): which truck has
 * it and since when, its whole history, and the same acts the truck page's card offers — move, retire,
 * void a wrong entry. Gated on equipment like the card, since the tags are the trucks' papers (D-TL11).
 *
 * The tag dialog is nested INSIDE the drawer, not beside it: HeadlessUI picks Escape's owner from the
 * DOM tree, and a sibling modal would close both (memory `sibling-dialogs-both-own-escape`).
 */
const props = defineProps<{ tag: TransponderDto | null }>();
const emit = defineEmits<{ close: [] }>();

const session = useSessionStore();
const canManage = computed(() => session.can("equipment"));
const { zone } = useOrgTimezone();
const at = (iso: string | null) => (iso ? formatDateTime(iso, "—", zone.value) : "—");
const action = ref<TollTagAction | null>(null);

const t = computed(() => props.tag);
const facts = computed<Fact[]>(() => {
  const x = t.value;
  if (!x) return [];
  return [
    { label: "Provider", value: TOLL_PROVIDER_LABEL[x.provider] },
    { label: "Tag number", value: x.tagNumber },
    { label: "Issued by", value: x.issuer ?? "—" },
    { label: "Truck now", value: tagUnit(x) ? `Unit ${tagUnit(x)}` : "None" },
    { label: "On it since", value: at(tagSince(x)) },
    ...(x.retiredAt ? [{ label: "Retired", value: at(x.retiredAt) }] : []),
  ];
});
</script>

<template>
  <SlideOver :open="t !== null" :title="t ? tagLabel(t) : 'Toll tag'" :description="t?.issuer ?? undefined" @close="emit('close')">
    <div v-if="t" class="space-y-6">
      <AppBadge :tone="TAG_STATUS_TONE[tagStatus(t)]" data-test="tag-status">{{ TAG_STATUS_LABEL[tagStatus(t)] }}</AppBadge>

      <section aria-labelledby="tag-facts-heading" class="space-y-2">
        <h3 id="tag-facts-heading" class="text-sm font-semibold text-ink">The tag</h3>
        <FactList :facts="facts" layout="rows" />
      </section>

      <section aria-labelledby="tag-history-heading" class="space-y-2">
        <h3 id="tag-history-heading" class="text-sm font-semibold text-ink">History</h3>
        <p class="text-xs text-ink-muted">Each toll is charged to the truck that had the tag on that day. A voided entry stays here, crossed out.</p>
        <TollTagHistory :tag="t" :can-manage="canManage" @void="(h, label) => (action = { kind: 'void', tag: t!, entryId: h.id, entryLabel: label })" />
      </section>

      <TollTagDialog :action="action" @close="action = null" />
    </div>
    <template #footer>
      <RouterLink v-if="t?.currentVehicleId" :to="`/vehicles/${t.currentVehicleId}`" class="mr-auto self-center text-sm font-medium text-link hover:text-link-hover" data-test="tag-open-truck">
        Open unit {{ tagUnit(t) }}
      </RouterLink>
      <template v-if="t && canManage && !t.retiredAt">
        <AppButton variant="ghost" data-test="tag-retire" @click="action = { kind: 'retire', tag: t }">Retire…</AppButton>
        <AppButton variant="primary" data-test="tag-move" @click="action = { kind: 'move', tag: t }">Move…</AppButton>
      </template>
    </template>
  </SlideOver>
</template>
