<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  INSPECTION_GROUPS,
  INSPECTION_ITEMS,
  deriveInspectionOutcome,
  inspectionItem,
  isInspectionItemApplicable,
  type InspectionResult,
  type InspectionSubjectType,
} from "@silvicom/shared";
import { AppButton as BaseButton, AppCallout, AppBadge } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import BaseModal from "@/components/ui/BaseModal.vue";
import InspectionItemRow from "@/features/maintenance/InspectionItemRow.vue";
import {
  useFinalizeInspection,
  useInspectionQuery,
  usePatchInspection,
} from "@/features/maintenance/useAnnualInspections";
import { fetchObjectUrl } from "@/lib/api";

/**
 * The §396.17 inspection form (plan step A7).
 *
 * ── THE VERDICT ON THIS PAGE IS THE SERVER'S OWN FUNCTION ──────────────────────────────────────
 * `deriveInspectionOutcome` is imported from `@silvicom/shared` and is the SAME function the
 * finalize route runs before it writes anything, and the same one the renderer's caller uses to
 * decide what to stamp. A banner computed some other way would be a second answer to a regulatory
 * question, and the first time the two disagreed the inspector would trust the screen.
 *
 * ── THE FORM OPENS PRE-FILLED; THE PDF DOES NOT EXIST YET (D-AVI13) ────────────────────────────
 * A draft is seeded complete by the API, so every component already carries the catalogue's opening
 * answer for that kind of equipment and the inspector changes what they find. Each row that is still
 * on its default says so, and the summary counts them — the owner ruled for the pre-fill knowing the
 * exposure, and this is what keeps it visible rather than invisible.
 */

const route = useRoute();
const id = computed(() => String(route.params.id ?? ""));

const { data, isLoading, isError, error, refetch } = useInspectionQuery(id);
const patch = usePatchInspection(id);
const finalize = useFinalizeInspection(id);

const report = computed(() => data.value?.inspection ?? null);
const items = computed(() => data.value?.items ?? []);
const subjectType = computed<InspectionSubjectType>(() => report.value?.subject_type ?? "tractor");
const isFinal = computed(() => report.value?.status === "final");

const byKey = computed(() => new Map(items.value.map((i) => [i.key, i])));

/** The report's own verdict, from the shared function. Never typed, never stored while draft. */
const derived = computed(() => {
  if (!items.value.length) return null;
  return deriveInspectionOutcome(
    items.value.map((i) => ({ key: i.key, result: i.result, repairedAt: i.repairedAt })),
    subjectType.value,
    report.value?.inspected_on ?? "1970-01-01",
  );
});
const outcome = computed(() => (derived.value?.ok ? derived.value.outcome : null));
const openDefects = computed(() => (derived.value?.ok ? derived.value.openDefects : []));
const stillDefault = computed(
  () => items.value.filter((i) => i.source === "default" && isApplicable(i.key)).length,
);

function isApplicable(key: string): boolean {
  const item = inspectionItem(key);
  return item ? isInspectionItemApplicable(item, subjectType.value) : false;
}

const groups = computed(() =>
  INSPECTION_GROUPS.map((g) => ({
    ...g,
    items: INSPECTION_ITEMS.filter((i) => i.group === g.number),
  })),
);

function setResult(key: string, result: InspectionResult) {
  if (isFinal.value) return;
  patch.mutate({ items: [{ key, result, repairedAt: result === "needs_repair" ? byKey.value.get(key)?.repairedAt ?? null : null }] });
}
function setRepaired(key: string, value: string | null) {
  if (isFinal.value) return;
  patch.mutate({ items: [{ key, result: "needs_repair", repairedAt: value }] });
}

const otherConditions = ref("");
watch(report, (r) => { if (r) otherConditions.value = r.other_conditions ?? ""; }, { immediate: true });

const confirming = ref(false);
const refusal = computed(() => finalize.error.value);

/**
 * Open the printed page in a new tab.
 *
 * Fetched with the session token and opened as a blob rather than navigated to: these routes sit
 * behind `requireAuth`, and a plain `window.open` on an API path carries no Authorization header.
 */
const openError = ref<string | null>(null);
async function openPdf(kind: "report" | "preview") {
  openError.value = null;
  try {
    const url = await fetchObjectUrl(`/api/maintenance/inspections/${id.value}/${kind}.pdf`);
    window.open(url, "_blank", "noopener");
    // Revoked on a delay rather than immediately: the new tab has to have loaded it first.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    openError.value = e instanceof Error ? e.message : "Could not open the document";
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="49 CFR §396.17 annual vehicle inspection. Every component carries a result before this report can be certified." />

    <AppCallout v-if="isError" tone="danger">
      {{ error?.message ?? "Could not load this inspection." }}
      <BaseButton size="sm" variant="secondary" class="ml-2" @click="() => refetch()">Retry</BaseButton>
    </AppCallout>

    <p v-else-if="isLoading" class="text-sm text-ink-tertiary">Loading the inspection…</p>

    <template v-else-if="report">
      <!-- The verdict, derived. There is no control here that sets it. -->
      <AppCallout :tone="isFinal ? (report.outcome === 'pass' ? 'success' : 'danger') : outcome === 'pass' ? 'success' : 'caution'">
        <span v-if="isFinal">
          Certified {{ report.outcome === "pass" ? "PASS" : "FAIL" }} —
          {{ report.outcome === "pass" ? `next due ${report.next_due_on}` : "this vehicle did not pass" }}.
          A certified report cannot be edited; a correction is a new inspection.
        </span>
        <span v-else-if="derived && !derived.ok">
          Not ready to certify: {{ derived.issues.map((i) => i.itemKeys.length).reduce((a, b) => a + b, 0) }}
          component(s) need attention before this report says what §396.21(a)(5) requires.
        </span>
        <span v-else>
          Would certify <strong>{{ outcome === "pass" ? "PASS" : "FAIL" }}</strong>.
          <template v-if="openDefects.length">
            {{ openDefects.length }} defect(s) with no repair date.
          </template>
          <template v-if="stillDefault"> · {{ stillDefault }} component(s) still on their default.</template>
        </span>
      </AppCallout>

      <div class="flex flex-wrap items-center gap-2">
        <BaseButton variant="secondary" @click="() => openPdf('preview')">
          Preview the printed page
        </BaseButton>
        <BaseButton v-if="isFinal" variant="secondary" @click="() => openPdf('report')">
          Print the filed report
        </BaseButton>
        <BaseButton v-else variant="primary" :disabled="patch.isPending.value" @click="confirming = true">
          Certify this inspection
        </BaseButton>
        <AppBadge v-if="patch.isPending.value" tone="info">Saving…</AppBadge>
      </div>

      <AppCallout v-if="openError" tone="danger">{{ openError }}</AppCallout>

      <AppCallout v-if="refusal" tone="danger">
        {{ refusal.message }}
        <ul v-if="refusal.issues?.length" class="mt-2 list-disc pl-5 text-sm">
          <li v-for="issue in refusal.issues" :key="issue.code">
            {{ issue.code.replaceAll("_", " ") }}: {{ issue.itemKeys.join(", ") }}
          </li>
        </ul>
      </AppCallout>

      <section v-for="group in groups" :key="group.number" class="rounded-surface ring-1 ring-edge-subtle">
        <h2 class="border-b border-edge-subtle bg-surface-subtle px-3 py-2 text-sm font-semibold text-ink">
          {{ group.number }}. {{ group.title }}
          <span class="ml-1 font-normal text-ink-tertiary">{{ group.cfr }}</span>
        </h2>
        <InspectionItemRow
          v-for="item in group.items"
          :key="item.key"
          :item="item"
          :subject-type="subjectType"
          :result="byKey.get(item.key)?.result ?? 'na'"
          :source="byKey.get(item.key)?.source ?? 'default'"
          :repaired-at="byKey.get(item.key)?.repairedAt ?? null"
          :disabled="isFinal"
          @set="(r) => setResult(item.key, r)"
          @set-repaired="(v) => setRepaired(item.key, v)"
        />
      </section>

      <BaseModal :open="confirming" title="Certify this inspection" @close="confirming = false">
        <p class="text-sm text-ink-secondary">
          This certifies that every component above was inspected and that
          <strong>{{ outcome === "pass" ? "the vehicle passed" : "the vehicle did not pass" }}</strong>,
          in accordance with 49 CFR Part 396. The report is filed against the vehicle and cannot be
          edited afterwards — a correction is a new inspection.
        </p>
        <p v-if="stillDefault" class="mt-3 text-sm text-caution-700">
          {{ stillDefault }} component(s) still carry the answer the form opened with.
        </p>
        <template #footer>
          <BaseButton variant="secondary" @click="confirming = false">Cancel</BaseButton>
          <BaseButton
            variant="primary"
            :disabled="finalize.isPending.value"
            @click="() => finalize.mutate(undefined, { onSuccess: () => (confirming = false) })"
          >
            Certify
          </BaseButton>
        </template>
      </BaseModal>
    </template>
  </div>
</template>
