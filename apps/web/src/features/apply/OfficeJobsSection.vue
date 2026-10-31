<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import { AppButton as BaseButton, AppInput as BaseInput, useConfirm } from "@silvicom/ui";
import {
  applicationEmployerSchema,
  applicationEmploymentGaps,
  formatDisplayDate,
  type ApplicationEmployer,
} from "@silvicom/shared";
import { ymd } from "@/lib/dateWindow";
import { useToastStore } from "@/stores/toast";
import { employerName } from "./officeJobs";
import { useEditApplicationAnswer } from "./useApplicationReview";

/**
 * The office's hand on the applicant's jobs (HIRING-WORKFLOW-AUDIT-2026-10-31 §9 P5): remove a blank or
 * duplicate one, and explain the time between them. Split out of `ApplicationReviewDrawer` at its
 * 500-line budget; adding a job stays there (`AddEmployerForm`) beside the answer list.
 *
 * Every write names the draft revision the drawer read, so a change the applicant made a second
 * earlier on their phone is never written over — the API refuses and the drawer reads it again.
 */
const props = defineProps<{
  invitationId: string;
  employers: Record<string, unknown>[];
  givenGaps: Array<{ from: string; explanation?: string }>;
  revision: number;
}>();

const toast = useToastStore();
const ask = useConfirm();
const edit = useEditApplicationAnswer(toRef(props, "invitationId"));

/**
 * §9 P5 (AF-4, Q-AX7): removing a job — a blank row the applicant left, or a duplicate. By its key, so
 * the corrections recorded against the other rows keep their place, and only after a confirm.
 * A row from before AW1 with no key is given one by the first edit; until then it cannot be removed.
 */
async function removeEmployer(row: Record<string, unknown>): Promise<void> {
  if (typeof row.key !== "string") return;
  const ok = await ask({
    title: `Remove ${employerName(row)}?`,
    message: "It comes off the application. The applicant is shown the removal before they sign.",
    confirmLabel: "Remove",
    tone: "danger",
  });
  if (!ok) return;
  try {
    await edit.mutateAsync({ op: "remove_employer", key: row.key, revision: props.revision });
    toast.push("success", `${employerName(row)} removed`);
  } catch (e) {
    toast.push("error", e instanceof Error ? e.message : "That job could not be removed.");
  }
}

/**
 * §9 P5: the gaps a filing will ask about — the same function the applicant's screen and the filing
 * read (`applicationEmploymentGaps`), over the jobs as they parse, against today. Each shows the
 * explanation on file and takes one from the office.
 */
const gaps = computed(() => {
  const parsed = props.employers
    .map((e) => applicationEmployerSchema.safeParse(e))
    .filter((r) => r.success)
    .map((r) => r.data as ApplicationEmployer);
  if (parsed.length === 0) return [];
  const given = props.givenGaps;
  return applicationEmploymentGaps(parsed, ymd(new Date())).map((g) => ({
    ...g,
    explanation: given.find((x) => x.from === g.from)?.explanation ?? "",
  }));
});
const gapDrafts = ref<Record<string, string>>({});
async function explainGap(gap: { from: string; to: string }): Promise<void> {
  const explanation = (gapDrafts.value[gap.from] ?? "").trim();
  if (!explanation) return;
  try {
    await edit.mutateAsync({ op: "explain_gap", gap: { from: gap.from, to: gap.to, explanation }, revision: props.revision });
    delete gapDrafts.value[gap.from];
    toast.push("success", "Gap explained");
  } catch (e) {
    toast.push("error", e instanceof Error ? e.message : "That explanation could not be saved.");
  }
}
</script>

<template>
  <div class="space-y-6">
        <!-- §9 P5 (AF-4, Q-AX7): a blank or duplicate job comes off, by its key, after a confirm. -->
    <section v-if="employers.length" class="space-y-2" data-testid="jobs">
      <h3 class="text-sm font-semibold text-ink">Jobs on the application</h3>
      <ul class="divide-y divide-edge">
        <li v-for="(row, i) in employers" :key="String(row.key ?? i)" class="flex items-center justify-between gap-3 py-2 text-sm">
          <span class="min-w-0 break-words text-ink">
            {{ employerName(row) }}
            <span class="text-ink-muted">
              · {{ formatDisplayDate(String(row.started_on ?? ""), "no start date") }} –
              {{ formatDisplayDate(String(row.ended_on ?? ""), "now") }}
            </span>
          </span>
          <BaseButton
            v-if="typeof row.key === 'string'"
            variant="danger"
            size="sm"
            :disabled="edit.isPending.value"
            @click="removeEmployer(row)"
          >
            Remove
          </BaseButton>
        </li>
      </ul>
    </section>

    <!-- §9 P5: the gaps a filing will ask about, explained from the office's side. -->
    <section v-if="gaps.length" class="space-y-2" data-testid="gaps">
      <h3 class="text-sm font-semibold text-ink">Time between jobs</h3>
      <p class="text-xs text-ink-muted">Over 30 days in the last three years. Ask what they were doing.</p>
      <ul class="space-y-3">
        <li v-for="gap in gaps" :key="gap.from" class="space-y-1">
          <p class="text-sm text-ink">
            {{ formatDisplayDate(gap.from) }} – {{ formatDisplayDate(gap.to) }}
            <span class="text-ink-muted">· {{ gap.days }} days</span>
          </p>
          <p v-if="gap.explanation" class="text-xs text-ink-secondary">On file: {{ gap.explanation }}</p>
          <div class="flex flex-col gap-2 sm:flex-row">
            <BaseInput
              :model-value="gapDrafts[gap.from] ?? ''"
              :aria-label="`What they were doing from ${formatDisplayDate(gap.from)}`"
              placeholder="For example: between jobs, school, caring for family"
              class="sm:flex-1"
              @update:model-value="gapDrafts[gap.from] = String($event)"
            />
            <BaseButton
              size="sm"
              :disabled="edit.isPending.value || !(gapDrafts[gap.from] ?? '').trim()"
              @click="explainGap(gap)"
            >
              {{ gap.explanation ? "Replace" : "Explain" }}
            </BaseButton>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
