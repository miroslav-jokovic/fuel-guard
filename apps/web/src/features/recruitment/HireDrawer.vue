<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { HANDOFF_SKIP_LABELS, RETURN_TO_DUTY_BLOCK, type HandoffSkipReason } from "@silvicom/shared";
import { AppButton as BaseButton, AppCallout, AppDateField, AppFormField as FormField } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useToastStore } from "@/stores/toast";
import { useHireApplicant, useHirePreviewQuery } from "@/features/recruitment/useHire";

/**
 * Hiring an applicant, with the file shown before the button is pressed (H8).
 *
 * The drawer exists because hiring is the last moment anything can be fixed cheaply. An inquiry
 * marked sent with no date cannot become a §391.51 record — the handoff refuses to invent a date —
 * and the person hiring is the only one who will notice in time. So the preview is not a summary of
 * what will happen; it is a list of what to go and fix first.
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
      `${props.fullName} is on the roster`,
      result.filed > 0
        ? `${result.filed} previous-employer record${result.filed === 1 ? "" : "s"} filed into their qualification file.`
        : "Their qualification file is open. Nothing was carried over.",
    );
    emit("close");
  } catch (e) {
    toast.error("Could not record the hire", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver :open="open" size="lg" :title="`Hire ${fullName}`" @close="emit('close')">
    <div class="space-y-6">
      <p class="text-sm text-ink-muted">
        Hiring opens their qualification file and carries the safety-history inquiries you have
        already recorded into it as dated evidence. Everything else they signed is already filed
        against them.
      </p>

      <FormField v-slot="{ id }" label="Hire date" hint="The three-year employment window is measured back from this date.">
        <AppDateField :id="id" v-model="hireDate" />
      </FormField>

      <div v-if="previewQ.isLoading.value" class="text-sm text-ink-muted">Reading the file…</div>

      <template v-else-if="previewQ.data.value">
        <div v-if="previewQ.data.value.skipped.length" class="rounded-surface bg-surface-muted p-3">
          <p class="text-xs font-medium text-ink-secondary">Worth fixing before you hire</p>
          <ul class="mt-2 space-y-1 text-sm">
            <li v-for="s in previewQ.data.value.skipped" :key="`${s.employmentId}-${s.reason}`">
              <span :class="[BADGE_BASE, toneClass('caution')]">{{ s.employerName }}</span>
              <span class="ml-2 text-ink-secondary">{{ skipLabel(s.reason) }}</span>
            </li>
          </ul>
          <p class="mt-2 text-xs text-ink-muted">
            These stay out of the file rather than being filed under a date nobody recorded. Add the
            dates and hire again, or hire now and record them on the driver's page.
          </p>
        </div>

        <!-- §40.25(j). Above the file-gaps block because it is a different kind of fact: those are
             documents to chase, this is a limit on what the driver may be given to do once hired.
             ⚠ Not a reason to refuse the hire and the drawer does not treat it as one — the
             regulation bars performing a safety-sensitive function, not being employed. The block
             lands at load assignment, where it belongs, and this is the warning that it will. -->
        <AppCallout v-if="previewQ.data.value.returnToDutyBlocked" tone="warning">
          {{ RETURN_TO_DUTY_BLOCK.hire }}
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
        <BaseButton variant="primary" :disabled="!hireDate || hire.isPending.value" @click="submit">
          {{ hire.isPending.value ? "Hiring…" : "Hire" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
