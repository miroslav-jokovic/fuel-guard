<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  HANDOFF_SKIP_LABELS,
  HIRE_REFUSES_WITHOUT,
  RETURN_TO_DUTY_BLOCK,
  hiringStep,
  type HandoffSkipReason,
} from "@silvicom/shared";
import { AppButton as BaseButton, AppCallout, AppDateField, AppFormField as FormField } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useToastStore } from "@/stores/toast";
import { useHireApplicant, useHirePreviewQuery } from "@/features/recruitment/useHire";
import { useApplicantChecklistQuery } from "@/features/recruitment/useApplicantChecklist";

/**
 * Hiring an applicant, with the file shown before the button is pressed (H8).
 *
 * The drawer exists because hiring is the last moment anything can be fixed cheaply. An inquiry
 * marked sent with no date cannot become a §391.51 record — the handoff refuses to invent a date —
 * and the person hiring is the only one who will notice in time. So the preview is not a summary of
 * what will happen; it is a list of what to go and fix first.
 *
 * ── "CLOSE APPLICATION" SINCE §14 (D-OF5, owner 2026-11-03) ─────────────────────────────────────
 * The carrier hires in McLeod, so the words are the office's: closing the application. The act is the
 * same one and has to be: McLeod's roster sweep HOLDS a driver it matches to an applicant
 * (`rosterMatch.ts`, RL1) until this turns the row into a driver, and then links McLeod's driver to it —
 * so the PSP, the MVR, the scans and the signed papers stay with the person.
 *
 * Nothing here blocks the hire. The carrier hired somebody; a product that refuses to write that
 * down does not prevent it, it just stops describing reality, and the driver would then have no
 * qualification file at all rather than one with a named gap.
 */
const props = defineProps<{ open: boolean; driverId: string | null; fullName: string }>();
const emit = defineEmits<{ close: [] }>();

const toast = useToastStore();
const target = computed(() => (props.open ? props.driverId : null));
const previewQ = useHirePreviewQuery(target);

/**
 * §9 P4 (Q-WF1 (a)): the hire refuses without the six federal checks, so they are shown BEFORE the
 * press — each done, or a link to the row that does it — from the same checklist fold the API's refusal
 * reads (`hireBlockers`). The press waits until all of them are done.
 *
 * §9 P12: the list is the `hired` row's own edges, which the fold stamps from the carrier's hire policy
 * (`hireRefusesWithout`) — six, or seven with the handbook switched on in Settings → Recruiting. Read
 * from the row, never recomputed here, so the drawer and the API's refusal cannot disagree. Before the
 * checklist answers, the six are shown (`HIRE_REFUSES_WITHOUT`), never an empty list.
 */
const checklistQ = useApplicantChecklistQuery(computed(() => target.value ?? ""));
const hireList = computed(
  () => checklistQ.data.value?.steps.find((s) => s.key === "hired")?.requires ?? HIRE_REFUSES_WITHOUT,
);
const federalChecks = computed(() =>
  hireList.value.map((key) => ({
    key,
    label: hiringStep(key).label,
    federal: hiringStep(key).federalGate,
    done: (checklistQ.data.value?.steps ?? []).some((s) => s.key === key && s.state === "done"),
  })),
);
const carrierRules = computed(() => federalChecks.value.some((c) => !c.federal));
const checksDone = computed(() => checklistQ.data.value !== undefined && federalChecks.value.every((c) => c.done));
const hire = useHireApplicant();

const hireDate = ref(new Date().toISOString().slice(0, 10));
watch(
  () => props.open,
  (open) => {
    if (open) hireDate.value = new Date().toISOString().slice(0, 10);
  },
);

const skipLabel = (reason: string): string =>
  HANDOFF_SKIP_LABELS[reason as HandoffSkipReason] ?? reason;

async function submit(): Promise<void> {
  if (!props.driverId) return;
  try {
    const result = await hire.mutateAsync({ driver_id: props.driverId, hire_date: hireDate.value });
    toast.success(
      `${props.fullName}'s application is closed`,
      result.filed > 0
        ? `${result.filed} previous-employer record${result.filed === 1 ? "" : "s"} filed into their qualification file.`
        : "They are on the roster with their qualification file. Nothing was carried over.",
    );
    emit("close");
  } catch (e) {
    toast.error("Could not close the application", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver :open="open" size="lg" :title="`Close ${fullName}'s application`" @close="emit('close')">
    <div class="space-y-6">
      <p class="text-sm text-ink-muted">
        Hire them in McLeod as usual. Closing the application here puts them on the roster with their
        qualification file, so the driver McLeod sends over links to it. Everything they signed is
        already in it.
      </p>

      <FormField v-slot="{ id }" label="First day" hint="The day they start. The three-year employment window is measured back from it.">
        <AppDateField :id="id" v-model="hireDate" />
      </FormField>

      <section data-testid="federal-checks">
        <h3 class="text-sm font-semibold text-ink">
          {{ carrierRules ? "Before closing" : "The six federal checks" }}
        </h3>
        <ul class="mt-2 space-y-1 text-sm">
          <li v-for="c in federalChecks" :key="c.key" class="flex items-center justify-between gap-3">
            <span class="text-ink">
              {{ c.label }}
              <span v-if="!c.federal" class="text-xs text-ink-muted"> · your company's rule</span>
            </span>
            <span v-if="c.done" :class="[BADGE_BASE, toneClass('success')]">Done</span>
            <BaseButton v-else-if="driverId" variant="link" size="sm" :to="`/recruitment/${driverId}?step=${c.key}`">
              Open
            </BaseButton>
          </li>
        </ul>
        <p v-if="checklistQ.data.value && !checksDone" class="mt-2 text-xs text-ink-muted">
          Closing waits for {{ carrierRules ? "every one of these" : "all six" }}. Everything else can be finished after.
        </p>
      </section>

      <div v-if="previewQ.isLoading.value" class="text-sm text-ink-muted">Reading the file…</div>

      <template v-else-if="previewQ.data.value">
        <div v-if="previewQ.data.value.skipped.length" class="rounded-surface bg-surface-muted p-3">
          <p class="text-xs font-medium text-ink-secondary">Worth fixing before you close it</p>
          <ul class="mt-2 space-y-1 text-sm">
            <li v-for="s in previewQ.data.value.skipped" :key="`${s.employmentId}-${s.reason}`">
              <span :class="[BADGE_BASE, toneClass('caution')]">{{ s.employerName }}</span>
              <span class="ml-2 text-ink-secondary">{{ skipLabel(s.reason) }}</span>
            </li>
          </ul>
          <p class="mt-2 text-xs text-ink-muted">
            Add their dates first, or close now and record them on the driver's page.
          </p>
        </div>

        <!-- §40.25(j). Above the file-gaps block because it is a different kind of fact: those are
             documents to chase, this is a limit on what the driver may be given to do once hired.
             ⚠ Not a reason to refuse the hire and the drawer does not treat it as one — the
             regulation bars performing a safety-sensitive function, not being employed. The block
             lands at load assignment, where it belongs, and this is the warning that it will. -->
        <AppCallout v-if="previewQ.data.value.returnToDutyBlocked" tone="warning">
          <!-- A Med-Stop hold is worded without the result: the recruiter may not read testing
               records, and unlike the admission the applicant never told them (MS2, F-5). -->
          {{ previewQ.data.value.returnToDutyCause === "violation" ? RETURN_TO_DUTY_BLOCK.hireViolation : RETURN_TO_DUTY_BLOCK.hire }}
        </AppCallout>

        <div v-if="previewQ.data.value.outstanding.length" class="rounded-surface bg-surface-muted p-3">
          <p class="text-xs font-medium text-ink-secondary">Their file will still need</p>
          <ul class="mt-2 space-y-1 text-sm">
            <li v-for="o in previewQ.data.value.outstanding" :key="o.key" class="text-ink-secondary">
              {{ o.label }}
            </li>
          </ul>
        </div>

        <p v-else class="text-sm text-ink-secondary">
          Their hiring file is complete once this is recorded.
        </p>
      </template>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton variant="ghost" :disabled="hire.isPending.value" @click="emit('close')">Cancel</BaseButton>
        <BaseButton variant="primary" :disabled="!hireDate || !checksDone || hire.isPending.value" @click="submit">
          {{ hire.isPending.value ? "Closing…" : "Close application" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
