<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  INSPECTION_GROUPS,
  INSPECTION_ITEMS,
  deriveInspectionOutcome,
  type InspectionResult,
} from "@silvicom/shared";
import { AppButton as BaseButton, AppCallout, AppBadge, AppCard as BaseCard } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import InspectionHeaderFields from "@/features/maintenance/InspectionHeaderFields.vue";
import InspectionItemRow from "@/features/maintenance/InspectionItemRow.vue";
import PrintInspectionDrawer from "@/features/maintenance/PrintInspectionDrawer.vue";
import DeleteInspectionDrawer from "@/features/maintenance/DeleteInspectionDrawer.vue";
import { useToastStore } from "@/stores/toast";
import { useOrgSettingsQuery } from "@/composables/useOrgSettings";
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
const toast = useToastStore();
const id = computed(() => String(route.params.id ?? ""));

const { data, isLoading, isError, error, refetch } = useInspectionQuery(id);
const patch = usePatchInspection(id);
const finalize = useFinalizeInspection(id);
const correct = useCorrectInspection();
const discard = useDiscardInspection();

const report = computed(() => data.value?.inspection ?? null);
const items = computed(() => data.value?.items ?? []);
const isFinal = computed(() => report.value?.status === "final");

/**
 * Whether this filing was drawn by an older version of the form.
 *
 * A completed report serves the BYTES IT WAS FILED WITH and is never re-rendered — that is what keeps
 * it reproducible against its own `documents.sha256`, and it is not going to change. So once the
 * drawing moves, a report certified before it keeps its old page forever.
 *
 * The screen used to offer a live preview beside that filed page, which made the two visibly
 * disagree and read as a bug in the template; the preview is now a draft-only control and the two
 * cannot be held side by side. This flag is what remains useful: it says so on the page, for
 * somebody comparing two PRINTOUTS rather than two buttons.
 *
 * Null `renderer_version` means the report was filed before 0284 recorded one, which is older than
 * any version we could name rather than equal to the current one.
 */
const filedDrawingIsStale = computed(() => {
  if (!isFinal.value || !report.value) return false;
  const current = data.value?.currentRendererVersion;
  return !!current && report.value.renderer_version !== current;
});

/**
 * Destroying the record (D-AVI29) — admin only, and separate from Discard.
 *
 * `session.admin` rather than `session.can("maintenance")`: a technician certifies inspections, they
 * do not destroy the record of one. The API gates on the same role, so this hides a button the
 * server would refuse rather than being the guard itself.
 */
const deleting = ref(false);
const canDeleteRecord = computed(() => session.admin);

function onDeleted() {
  deleting.value = false;
  toast.success("Record deleted");
  void router.push({ name: "annual-inspections" });
}

const byKey = computed(() => new Map(items.value.map((i) => [i.key, i])));

/** The report's own verdict, from the shared function. Never typed, never stored while draft. */
const derived = computed(() => {
  if (!items.value.length) return null;
  return deriveInspectionOutcome(
    items.value.map((i) => ({ key: i.key, result: i.result, repairedAt: i.repairedAt })),
    report.value?.inspected_on ?? "1970-01-01",
  );
});
const outcome = computed(() => (derived.value?.ok ? derived.value.outcome : null));
const openDefects = computed(() => (derived.value?.ok ? derived.value.openDefects : []));
/**
 * How many components still carry the answer the form opened with (D-AVI13).
 *
 * Every component counts now, not just the "applicable" ones: both default columns are transcribed
 * from real filled forms, so an `N/A` a trailer opens on is as much a recorded answer as an `Ok` —
 * and it is exactly the kind nobody looks at twice, which is why the count says so.
 */
const stillDefault = computed(() => items.value.filter((i) => i.source === "default").length);

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

const org = useOrgSettingsQuery();
const carrierName = computed(() => org.data.value?.name ?? "Our own technician");

/**
 * The header values, editable while the report is a draft.
 *
 * A decal is often applied at the END of the job — the truck is back together, the sticker goes on,
 * the number is transcribed — so the drawer that opened the report cannot be the only place it can
 * be entered. Same component as the drawer mounts, so the two cannot ask for it differently.
 *
 * Patched on change rather than on a Save button, matching how every component result on this page
 * is written: the PATCH answers with the report as the database holds it, so the page never believes
 * a save the server did not take.
 */
function setDecalSerial(value: string | null) {
  if (isFinal.value || value === (report.value?.decal_serial ?? null)) return;
  patch.mutate({ decalSerial: value });
}
function setAgency(value: string | null) {
  if (isFinal.value || value === (report.value?.inspection_agency_location ?? null)) return;
  patch.mutate({ inspectionAgencyLocation: value });
}

const otherConditions = ref("");
watch(report, (r) => { if (r) otherConditions.value = r.other_conditions ?? ""; }, { immediate: true });

const refusal = computed(() => finalize.error.value);

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
    toast.error("Could not start the correction", e instanceof Error ? e.message : undefined);
  }
}

/** Only a draft. The API refuses a completed one by name — nothing here relies on this check alone. */
async function discardDraft() {
  if (!window.confirm("Discard this inspection? Nothing has been filed yet, and it cannot be recovered.")) return;
  try {
    await discard.mutateAsync(id.value);
    toast.success("Inspection discarded");
    await router.push({ name: "annual-inspections" });
  } catch (e) {
    toast.error("Could not discard the inspection", e instanceof Error ? e.message : undefined);
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
/**
 * Open the printed page in a new tab.
 *
 * Fetched with the session token and opened as a blob rather than navigated to: these routes sit
 * behind `requireAuth`, and a plain `window.open` on an API path carries no Authorization header.
 */
async function openPdf(kind: "report" | "preview") {
  try {
    const url = await fetchObjectUrl(`/api/maintenance/inspections/${id.value}/${kind}.pdf`);
    window.open(url, "_blank", "noopener");
    // Revoked on a delay rather than immediately: the new tab has to have loaded it first.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    toast.error("Could not open the document", e instanceof Error ? e.message : undefined);
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
          <template v-if="outcome === 'pass' && !report.decal_serial">
            · No sticker number recorded — a passing inspection normally gets a decal, and that
            sticker is what an officer reads off the vehicle.
          </template>
        </span>
      </AppCallout>

      <!-- Not a toast: this is a standing condition of the report rather than feedback on an action,
           and it has to be readable at the moment somebody is choosing between the two buttons
           underneath it. -->
      <AppCallout v-if="filedDrawingIsStale" tone="caution">
        This report was filed on an earlier version of the printed form, so it will not look like one
        completed today. The filed copy is the evidence and prints exactly as it was certified — it is
        never re-drawn. To put the current form on paper, record a correction, which files a new
        report.
      </AppCallout>

      <div class="flex flex-wrap items-center gap-2">
        <BaseButton v-if="isFinal && session.can('maintenance')" variant="secondary" @click="startCorrection">
          Record a correction
        </BaseButton>
        <BaseButton v-if="!isFinal && session.can('maintenance')" variant="ghost" @click="discardDraft">
          Discard
        </BaseButton>
        <!-- ── NOT ON A CERTIFIED REPORT, AND THAT IS THE POINT ──────────────────────────────
             A preview is drawn NOW; a certified report serves the bytes it was FILED with and is
             never re-rendered. Same renderer, same template, same coordinate map — different
             moment. So the day the drawing changes, an older filing and a fresh preview of it are
             two different-looking pages, and offering both on one screen invites a comparison
             whose answer is "the code moved", which is not something the office should have to
             know. Preview exists so they can see what will print BEFORE they certify (D-AVI14).
             After that the page exists and there is exactly one of it. -->
        <BaseButton v-if="!isFinal" variant="secondary" @click="() => openPdf('preview')">
          Preview the printed page
        </BaseButton>
        <BaseButton v-if="isFinal" variant="secondary" @click="printing = true">
          Print
        </BaseButton>
        <BaseButton v-else variant="primary" :disabled="patch.isPending.value" @click="completeInspection">
          Complete inspection
        </BaseButton>
        <!-- Deliberately last, and `ghost` rather than `danger`: the destructive control should be
             findable, not the thing the eye lands on first. The drawer is where it gets loud. -->
        <BaseButton v-if="canDeleteRecord" variant="ghost" @click="deleting = true">
          Delete this record
        </BaseButton>
        <AppBadge v-if="patch.isPending.value" tone="info">Saving…</AppBadge>
      </div>

      <!-- The one refusal that is NOT a toast, and the reason is the list under it. §5.8's rule is
           about mutation FEEDBACK — "saved", "could not save" — and a toast is the right shape for a
           sentence that expires. This one names the components that still need an answer, which is a
           worklist: it has to stay on screen next to the rows it is talking about, and it has to
           survive the four seconds a toast lives for. -->
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
      <!-- The header block the printed page carries and the item rows do not: the decal serial and
           who performed the inspection. Shown for a completed report too, read-only, because a filed
           report has to be readable in full from the page that represents it. -->
      <BaseCard as="section" padding="md">
        <InspectionHeaderFields
          :decal-serial="report.decal_serial"
          :agency="report.inspection_agency_location"
          :carrier-name="carrierName"
          :disabled="isFinal"
          @update:decal-serial="setDecalSerial"
          @update:agency="setAgency"
        />
      </BaseCard>

      <BaseCard v-for="group in groups" :key="group.number" as="section" padding="none">
        <h3 class="border-b border-edge-subtle px-4 py-3 text-base font-semibold text-ink">
          {{ group.number }}. {{ group.title }}
        </h3>
        <InspectionItemRow
          v-for="item in group.items"
          :key="item.key"
          :item="item"
          :result="byKey.get(item.key)?.result ?? 'na'"
          :source="byKey.get(item.key)?.source ?? 'default'"
          :repaired-at="byKey.get(item.key)?.repairedAt ?? null"
          :disabled="isFinal"
          @set="(r) => setResult(item.key, r)"
          @set-repaired="(v) => setRepaired(item.key, v)"
        />
      </BaseCard>

      <PrintInspectionDrawer
        :open="printing"
        :inspection-id="id"
        :can-manage="session.can('maintenance')"
        @close="printing = false"
      />
      <DeleteInspectionDrawer
        :open="deleting"
        :inspection-id="id"
        :unit-number="report.unit_number ?? ''"
        :status="report.status"
        @close="deleting = false"
        @deleted="onDeleted"
      />



    </template>
  </div>
</template>
