<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  INSPECTION_GROUPS,
  INSPECTION_ITEMS,
  deriveInspectionOutcome,
  inspectionItem,
  isInspectionItemApplicable,
  type InspectionResult,
  type InspectionSubjectType,
} from "@silvicom/shared";
import { AppButton as BaseButton, AppCallout, AppBadge, AppCard as BaseCard } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import SlideOver from "@/components/SlideOver.vue";
import InspectionItemRow from "@/features/maintenance/InspectionItemRow.vue";
import PrintInspectionForm from "@/features/maintenance/PrintInspectionForm.vue";
import { useSessionStore } from "@/stores/session";
import {
  useCorrectInspection,
  useDiscardInspection,
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
const router = useRouter();
const session = useSessionStore();
const id = computed(() => String(route.params.id ?? ""));

const { data, isLoading, isError, error, refetch } = useInspectionQuery(id);
const patch = usePatchInspection(id);
const finalize = useFinalizeInspection(id);
const correct = useCorrectInspection();
const discard = useDiscardInspection();

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

const refusal = computed(() => finalize.error.value);

/**
 * Open the printed page in a new tab.
 *
 * Fetched with the session token and opened as a blob rather than navigated to: these routes sit
 * behind `requireAuth`, and a plain `window.open` on an API path carries no Authorization header.
 */
const openError = ref<string | null>(null);
const printing = ref(false);

/**
 * Completing an inspection is irreversible and this is how the product asks about irreversible
 * things — `window.confirm`, the same as retiring a vehicle or deleting a cost schedule. The
 * alternative was a bespoke dialog, and `DESIGN-SYSTEM-CONTRACT.md` §3 is explicit that a centred
 * modal is for content needing WIDTH; a sentence is not that, and "never build a bespoke overlay in
 * a feature folder" covers the rest.
 *
 * What is being certified stays ON THE PAGE, where it can be read properly: the derived verdict
 * banner and the count of parts still on their opening answer are both above this button.
 */
/**
 * A completed report cannot be edited, so a mistake is fixed by superseding it (D-AVI4). The new
 * draft opens seeded with what the previous one found, so one wrong mark is one edit.
 */
async function startCorrection() {
  if (
    !window.confirm(
      "Start a correction? The completed inspection stays on file exactly as it is, and the new one" +
        " will replace it — opening with the answers it recorded so you only change what was wrong.",
    )
  ) {
    return;
  }
  try {
    const newId = await correct.mutateAsync(id.value);
    await router.push({ name: "annual-inspection", params: { id: newId } });
  } catch (e) {
    openError.value = e instanceof Error ? e.message : "Could not start the correction";
  }
}

/** Only a draft. The API refuses a completed one by name — nothing here relies on this check alone. */
async function discardDraft() {
  if (!window.confirm("Discard this inspection? Nothing has been filed yet, and it cannot be recovered.")) return;
  try {
    await discard.mutateAsync(id.value);
    await router.push({ name: "annual-inspections" });
  } catch (e) {
    openError.value = e instanceof Error ? e.message : "Could not discard the inspection";
  }
}

function completeInspection() {
  const verdict = outcome.value === "pass" ? "PASSED" : "DID NOT PASS";
  const stale = stillDefault.value
    ? ` ${stillDefault.value} part(s) still carry the answer the form opened with.`
    : "";
  if (
    !window.confirm(
      `Record that every part was inspected and this vehicle ${verdict}?${stale}` +
        " It is filed against the vehicle and cannot be edited afterwards — a correction is a new inspection.",
    )
  ) {
    return;
  }
  finalize.mutate();
}
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
    <PageHeader description="Every part below carries a result before this inspection can be completed." />

    <AppCallout v-if="isError" tone="danger">
      {{ error?.message ?? "Could not load this inspection." }}
      <BaseButton size="sm" variant="secondary" class="ml-2" @click="() => refetch()">Retry</BaseButton>
    </AppCallout>

    <p v-else-if="isLoading" class="text-sm text-ink-tertiary">Loading the inspection…</p>

    <template v-else-if="report">
      <!-- The verdict, derived. There is no control here that sets it. -->
      <AppCallout :tone="isFinal ? (report.outcome === 'pass' ? 'success' : 'danger') : outcome === 'pass' ? 'success' : 'caution'">
        <span v-if="isFinal">
          Completed — {{ report.outcome === "pass" ? "PASSED" : "FAILED" }}{{ report.outcome === "pass" ? `, next due ${report.next_due_on}` : "" }}.
          A completed inspection cannot be edited; a correction is a new one.
        </span>
        <span v-else-if="derived && !derived.ok">
          Not ready to complete: {{ derived.issues.map((i) => i.itemKeys.length).reduce((a, b) => a + b, 0) }}
          part(s) still need an answer.
        </span>
        <span v-else>
          Result so far: <strong>{{ outcome === "pass" ? "PASSED" : "FAILED" }}</strong>.
          <template v-if="openDefects.length">
            {{ openDefects.length }} part(s) need repair with no repair date.
          </template>
          <template v-if="stillDefault"> · {{ stillDefault }} part(s) still on the opening answer.</template>
        </span>
      </AppCallout>

      <div class="flex flex-wrap items-center gap-2">
        <BaseButton v-if="isFinal && session.can('maintenance')" variant="secondary" @click="startCorrection">
          Record a correction
        </BaseButton>
        <BaseButton v-if="!isFinal && session.can('maintenance')" variant="ghost" @click="discardDraft">
          Discard
        </BaseButton>
        <BaseButton variant="secondary" @click="() => openPdf('preview')">
          Preview the printed page
        </BaseButton>
        <BaseButton v-if="isFinal" variant="secondary" @click="printing = true">
          Print
        </BaseButton>
        <BaseButton v-else variant="primary" :disabled="patch.isPending.value" @click="completeInspection">
          Complete inspection
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

      <!-- `BaseCard` rather than a hand-rolled panel: a bordered surface with a heading is exactly
           what it is, and the contract's rule against bespoke chrome applies to a page as much as to
           an overlay. Heading is `text-base` — the card-section size — not the drawer's `text-sm`. -->
      <BaseCard v-for="group in groups" :key="group.number" as="section" padding="none">
        <h3 class="border-b border-edge-subtle px-4 py-3 text-base font-semibold text-ink">
          {{ group.number }}. {{ group.title }}
        </h3>
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
      </BaseCard>

      <SlideOver :open="printing" title="Print inspection" @close="printing = false">
        <PrintInspectionForm
          :inspection-id="id"
          :can-manage="session.can('maintenance')"
          @cancel="printing = false"
        />
      </SlideOver>


    </template>
  </div>
</template>
