<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton, AppCard as BaseCard, QueryState } from "@silvicom/ui";
import { formatDisplayDateTime, type ApplicantActivityEdit, type ApplicantActivityItem } from "@silvicom/shared";
import { useApplicantActivityQuery } from "@/features/recruitment/useApplicantNotes";

/**
 * Everything that has happened on one applicant, newest first (HIRING-WORKFLOW-AUDIT-2026-10-31 §8.2,
 * §9 P10). Read-only and derived: the API folds it from the records already on file
 * (`applicantActivity.ts`), so there is nothing here to write and nothing it can disagree with.
 *
 * ⚠ **An office correction is named by the PAGE, not here.** The words for a field on the application
 * live with the form the applicant reads (`features/apply/fieldLabels.ts`), and this feature may not
 * import that one (`lint:boundaries`). So the page — which may import both — passes `describeEdit`
 * in, the same way it owns the review drawer that this feature cannot open. A second label table
 * here would be the copy that drifts.
 */
const props = defineProps<{
  driverId: string;
  describeEdit: (edit: ApplicantActivityEdit) => string;
}>();

const activityQ = useApplicantActivityQuery(computed(() => props.driverId));

/** The list grows with the application; the first screenful is what is usually wanted. */
const FIRST = 12;
const showAll = ref(false);
const items = computed(() => activityQ.data.value ?? []);
const shown = computed(() => (showAll.value ? items.value : items.value.slice(0, FIRST)));

function sentence(item: ApplicantActivityItem): string {
  if (item.kind === "answer_edited" && item.edit) return `${item.actor ?? "The office"} ${props.describeEdit(item.edit)}`;
  return item.actor ? `${item.text} — ${item.actor}` : item.text;
}
</script>

<template>
  <BaseCard>
    <h3 class="text-sm font-semibold text-ink">Activity</h3>
    <div class="mt-3">
      <QueryState
        :loading="activityQ.isLoading.value"
        :error="activityQ.isError.value ? activityQ.error.value : null"
        :retrying="activityQ.isFetching.value"
        loading-text="Loading the activity…"
        error-text="Could not load what has happened on this application."
        compact
        @retry="activityQ.refetch()"
      >
        <p v-if="items.length === 0" class="text-sm text-ink-muted">Nothing has happened yet.</p>
        <ol v-else class="divide-y divide-edge">
          <li
            v-for="(item, i) in shown"
            :key="`${item.at}-${item.kind}-${i}`"
            class="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2"
            data-test="activity"
          >
            <span class="w-40 shrink-0 text-xs tabular-nums text-ink-muted">{{ formatDisplayDateTime(item.at) }}</span>
            <span class="min-w-0 flex-1 text-sm text-ink-secondary">{{ sentence(item) }}</span>
          </li>
        </ol>
        <BaseButton v-if="items.length > FIRST" class="mt-2" variant="link" @click="showAll = !showAll">
          {{ showAll ? "Show less" : `Show all ${items.length}` }}
        </BaseButton>
      </QueryState>
    </div>
  </BaseCard>
</template>
