<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { AppButton as BaseButton, AppCard as BaseCard, FactList, type Fact, QueryState } from "@silvicom/ui";
import type { InspectionSubjectType } from "@silvicom/shared";
import GatedLink from "@/components/GatedLink.vue";
import { formatDate } from "@/lib/format";
import { useSessionStore } from "@/stores/session";
import { useOpens } from "@/composables/useOpens";
import InspectionExpiryCell from "./InspectionExpiryCell.vue";
import NewInspectionDrawer from "./NewInspectionDrawer.vue";
import { useInspectionsQuery } from "./useAnnualInspections";

/**
 * Annual inspection — the §396.17 record for this unit (MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md §4.3):
 * when it expires by OUR record (`inspectionExpiry`, the one rule the roster, the board and the
 * worklist share), the last report filed here, and Start inspection — the inspector's verb (Q-MX1),
 * opening the same drawer the Annual inspections page opens, with this unit already chosen.
 *
 * The expiry is the roster's date, which McLeod's sweep or a filed report writes; "Not recorded" is a
 * roster gap and says so rather than reading as "fine".
 */
const props = defineProps<{ kind: InspectionSubjectType; unitId: string; unitNumber: string; expiresOn: string | null; today: string }>();
const router = useRouter();
const session = useSessionStore();
const opens = useOpens();

/** The most recent report on this unit, final or draft — one page of one. */
const filter = ref({ subjectType: props.kind, subjectId: props.unitId, page: 1 });
const q = useInspectionsQuery(filter);
const last = computed(() => (q.data.value?.inspections ?? [])[0] ?? null);
const total = computed(() => q.data.value?.total ?? 0);

/** Two facts, each drawn by its slot: the expiry's badge and the report's link are not plain values. */
const FACTS: Fact[] = [
  { key: "expires", label: "Expires" },
  { key: "last", label: "Last report here" },
];
const canStart = computed(() => session.can("maintenance") && opens("/shop/inspections"));
const starting = ref(false);
/** The page's header verb opens the same drawer. */
function start() {
  if (canStart.value) starting.value = true;
}
defineExpose({ start });
function onCreated(id: string) {
  starting.value = false;
  void router.push({ name: "annual-inspection", params: { id } });
}
</script>

<template>
  <BaseCard id="section-annual" class="scroll-mt-6" data-test="unit-annual">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-sm font-semibold text-ink">Annual inspection</h2>
      <BaseButton v-if="canStart" variant="primary" data-test="start-inspection" @click="starting = true">Start inspection</BaseButton>
    </div>
    <FactList class="mt-3" layout="rows" :facts="FACTS">
      <template #value-expires>
        <InspectionExpiryCell :expires-on="expiresOn" :today="today" />
      </template>
      <template #value-last>
        <QueryState compact :loading="q.isPending.value && !q.isError.value" :error="q.isError.value" :retrying="q.isFetching.value" loading-text="Looking for the report…" error-text="Could not load the reports." @retry="q.refetch()">
          <template v-if="last">
            <GatedLink :to="`/shop/inspections/${last.id}`" class="font-medium text-link hover:text-link-hover" plain-class="font-medium text-ink">
              {{ formatDate(last.inspected_on) }}
            </GatedLink>
            <span class="font-normal text-ink-muted"> · {{ last.status === "draft" ? "draft" : last.outcome === "fail" ? "failed" : "passed" }}<template v-if="last.inspector_name"> · {{ last.inspector_name }}</template><template v-if="total > 1"> · {{ total }} on file</template></span>
          </template>
          <span v-else class="font-normal text-ink-muted">None filed here yet</span>
        </QueryState>
      </template>
    </FactList>
    <NewInspectionDrawer :open="starting" :preset-type="kind" :preset-id="unitId" @created="onCreated" @close="starting = false" />
  </BaseCard>
</template>
