<script setup lang="ts">
import { computed, nextTick, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { TRAILER_TYPE_LABELS, type Trailer } from "@silvicom/shared";
import { supabase } from "@/lib/supabase";
import StatusBadge from "@/components/StatusBadge.vue";
import {
  AppCard as BaseCard,
  AppTabs,
  type TabItem,
  FactList,
  type Fact,
  QueryState,
  NotFoundError,
  isNotFound,
} from "@silvicom/ui";
import HolderEquipmentCard from "@/features/inventory/HolderEquipmentCard.vue";
import UnitWorkOrdersCard from "@/features/maintenance/UnitWorkOrdersCard.vue";
import UnitInspectionsCard from "@/features/roadside/UnitInspectionsCard.vue";
import UnitFileSection from "@/components/files/UnitFileSection.vue";
import type { UnitFileSubject } from "@/components/files/fileSubject";
import PageHeader from "@/components/ui/PageHeader.vue";
import { gpsPairingNote } from "@/lib/trailerPairingNote";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { TRAILER_SECTIONS, resolveTrailerSection, type TrailerSection } from "./trailerSections";

/**
 * One trailer, one page (UNIT-FILES-PLAN UF5), on the truck page's model: Overview · File ·
 * Maintenance, with `?section=` an anchor the strip scrolls to (D-ROS5). New with this step — a
 * trailer had a row on the Trailers list and nowhere to open. Its file (D-UF1) and its kit were
 * already built for a `trailer` subject; this is the page that puts them beside each other.
 */
const route = useRoute();
const router = useRouter();
const id = computed(() => String(route.params.id));

const SECTIONS: TabItem[] = TRAILER_SECTIONS.map((s) => ({ value: s.value, label: s.label }));
const section = computed<TrailerSection>(() => resolveTrailerSection(route.query.section));
function scrollToSection(s: TrailerSection): void {
  const el = typeof document !== "undefined" ? document.getElementById(`section-${s}`) : null;
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}
watch(section, (s) => void nextTick(() => scrollToSection(s)), { immediate: true });
function setSection(s: TrailerSection): void {
  void router.replace({ query: { ...route.query, section: s === "overview" ? undefined : s } });
}
const fileSubject = computed<UnitFileSubject>(() => ({ type: "trailer", id: id.value }));

/** The row, as the truck page reads its own: a refusal throws (F9), and no row is not-found (F21). */
const trailerQuery = useQuery({
  queryKey: ["trailer", id],
  queryFn: async (): Promise<Trailer> => {
    const { data, error } = await supabase.from("trailers").select("*").eq("id", id.value).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundError("That trailer is not on the fleet.");
    return data as Trailer;
  },
});
const trailer = trailerQuery.data;
const missing = computed(() => isNotFound(trailerQuery.error.value));

// The GPS pairing's truck, by name — the list the Trailers page already holds.
const { data: vehicles } = useVehiclesQuery();
const pairedUnit = computed(() => {
  const vid = trailer.value?.assigned_vehicle_id;
  return vid ? ((vehicles.value ?? []).find((v) => v.id === vid)?.unit_number ?? null) : null;
});

/** The summary's facts (D-US6): a blank is `null`, so the list draws its dash rather than a bare unit. */
const facts = computed<Fact[]>(() => {
  const t = trailer.value;
  if (!t) return [];
  const note = gpsPairingNote(t);
  return [
    { label: "Type", value: t.trailer_type ? TRAILER_TYPE_LABELS[t.trailer_type] : null },
    { label: "Plate", value: t.plate },
    { label: "Reefer", value: t.is_reefer ? `Yes · ${t.reefer_tank_capacity_gal} gal tank` : "No" },
    { label: "Cargo capacity", value: t.cargo_capacity_gal != null ? `${t.cargo_capacity_gal} gal` : null },
    { label: "GPS pairing", value: pairedUnit.value ? `Unit ${pairedUnit.value}${note ? ` (${note})` : ""}` : null },
  ];
});
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :title="trailer ? `Trailer ${trailer.unit_number}` : 'Trailer'"
      :description="trailer ? [trailer.year, trailer.make, trailer.model].filter(Boolean).join(' ') || 'The trailer, its file and its maintenance record' : 'The trailer, its file and its maintenance record'"
    />
    <QueryState
      :loading="trailerQuery.isLoading.value"
      :error="trailerQuery.isError.value ? trailerQuery.error.value : null"
      :retrying="trailerQuery.isFetching.value"
      loading-text="Loading the trailer…"
      error-text="Could not load this trailer."
      not-found-text="That trailer is not on the fleet. The link may be incomplete, or the trailer belongs to another company."
      @retry="trailerQuery.refetch()"
    >
      <BaseCard v-if="trailer" id="section-overview" class="scroll-mt-6">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-ink">Trailer summary</h2>
          <StatusBadge :status="trailer.status" />
        </div>
        <FactList class="mt-4" :facts="facts" />
      </BaseCard>
    </QueryState>

    <template v-if="!missing">
      <AppTabs
        :model-value="section"
        :tabs="SECTIONS"
        label="Trailer sections"
        @update:model-value="setSection($event as TrailerSection)"
      />

      <section id="section-file" class="scroll-mt-6">
        <UnitFileSection v-if="trailer" :subject="fileSubject" :unit-number="trailer.unit_number" :plate="trailer.plate" />
      </section>

      <section id="section-maintenance" class="scroll-mt-6 space-y-4">
        <!-- Read only and gated `maintenance: view`, as on the truck page: a window, never a control. -->
        <HolderEquipmentCard v-if="trailer" :target="{ kind: 'trailer', id, label: `Trailer ${trailer.unit_number}` }" />
        <UnitWorkOrdersCard v-if="trailer" kind="trailer" :unit-id="id" />
        <UnitInspectionsCard v-if="trailer" kind="trailer" :unit-number="trailer.unit_number" :plate="trailer.plate" />
      </section>
    </template>
  </div>
</template>
