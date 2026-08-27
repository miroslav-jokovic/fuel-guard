<script setup lang="ts">
import { AppButton as BaseButton } from "@silvicom/ui";
import BaseModal from "@/components/ui/BaseModal.vue";

/**
 * The confirmation before a person disappears from a list (migration 0235).
 *
 * ── WHY A DIALOG AT ALL, WHEN THE ACT IS REVERSIBLE ───────────────────────────────────────────
 * Because "archive" is the word a user has learned means DELETE in most products, and the one thing
 * this dialog has to do is say what actually happens: the row stops appearing in one list, and
 * nothing else changes. `drivers` is in `RETENTION_FORBIDDEN` (D-BD12) and 0235 refuses the DELETE
 * for everybody including the service role, so there is no destructive version of this button to be
 * confused with. Stating that is worth an extra click.
 *
 * ── AND WHY IT IS SHARED BETWEEN TWO PAGES ────────────────────────────────────────────────────
 * `DriversPage` and `RecruitmentPage` archive the same table for two different lists. Two copies of
 * this copy would drift, and the sentence explaining what archiving does is exactly the sentence that
 * must not say two different things on two screens. It lives in `components/` rather than in either
 * feature because `lint:boundaries` stops one feature importing another's internals, and this is
 * neither one's.
 */
const props = defineProps<{
  /** The person, or null when nothing is being archived — the modal's own open/closed state. */
  subject: { full_name: string } | null;
  /** "applicant" changes only the nouns; the act and the guarantees are identical. */
  kind: "applicant" | "driver";
  busy?: boolean;
}>();
const emit = defineEmits<{ close: []; confirm: [] }>();

const listName = (): string => (props.kind === "applicant" ? "the applicant board" : "the roster");
</script>

<template>
  <BaseModal
    :open="subject !== null"
    :title="`Archive ${subject?.full_name ?? ''}?`"
    @close="emit('close')"
  >
    <div class="space-y-3 text-sm text-ink-secondary">
      <p>
        They come off {{ listName() }}. Their page still opens, their file is unchanged, and anything
        they signed stays exactly as they signed it.
      </p>
      <p>You can put them back at any time — switch this list to Archived and restore them.</p>
    </div>
    <template #footer>
      <div class="flex justify-end gap-3">
        <BaseButton variant="secondary" @click="emit('close')">Cancel</BaseButton>
        <BaseButton variant="primary" :disabled="busy" @click="emit('confirm')">
          {{ busy ? "Archiving…" : "Archive" }}
        </BaseButton>
      </div>
    </template>
  </BaseModal>
</template>
