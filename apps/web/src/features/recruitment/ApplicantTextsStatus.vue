<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { formatDate } from "@/lib/format";
import { useToastStore } from "@/stores/toast";
import { useApplicantSmsConsentQuery, useRecordSmsStop } from "@/features/recruitment/useApplicantSmsConsent";

/**
 * One line on the send-application panel: will a text reach this applicant? (SMS-OPT-IN-PLAN SMS4.)
 *
 * ── FOUR ANSWERS, EACH WITH THE OFFICE'S NEXT MOVE ────────────────────────────────────────────
 * Not available yet (the wording waits on counsel, D-SMS8), not agreed (they can turn texts on from
 * their own link — the office cannot, D-SMS3), on (and the application link is texted too, D-SMS7),
 * or stopped (and not ours to ask again). The words are the whole feature; a coloured dot with no
 * next move is the thing a recruiter cannot act on.
 *
 * ── RECORDING A STOP IS TWO PRESSES ───────────────────────────────────────────────────────────
 * 47 CFR §64.1200(a)(10): a request to stop made by phone or email counts, so the office needs a way
 * to record one (D-SMS6). It cannot be undone — 0233 makes a revocation final — so the first press
 * only asks, and the second records. A mis-tap that silently ended somebody's texts would be the
 * failure nobody could see.
 */
const props = defineProps<{ driverId: string; canManage: boolean }>();

const toast = useToastStore();
const status = useApplicantSmsConsentQuery(toRef(props, "driverId"));
const stop = useRecordSmsStop();
const confirming = ref(false);

const s = computed(() => status.data.value ?? null);

async function recordStop(): Promise<void> {
  try {
    await stop.mutateAsync(props.driverId);
    toast.success("Texts stopped", "Recorded that the applicant asked to stop. Nothing more will be texted.");
  } catch (e) {
    toast.error("Could not record the stop", e instanceof Error ? e.message : undefined);
  } finally {
    confirming.value = false;
  }
}
</script>

<template>
  <div v-if="s" class="space-y-2 text-xs text-ink-secondary">
    <p v-if="!s.offered">
      <span class="font-medium text-ink">Texts:</span> not available yet — the text-message wording is
      waiting on legal review. Email and the link on screen carry everything.
    </p>
    <p v-else-if="s.state === 'none'">
      <span class="font-medium text-ink">Texts:</span> not agreed. The applicant can turn texts on from
      their own link; email and the link on screen carry everything meanwhile.
    </p>
    <template v-else-if="s.state === 'agreed'">
      <p>
        <span class="font-medium text-ink">Texts:</span> on, to the number ending {{ s.phoneLast4 }}
        since {{ formatDate(s.grantedAt) }}. The application link is texted as well as emailed.
      </p>
      <div v-if="canManage" class="flex flex-wrap items-center gap-2">
        <template v-if="confirming">
          <span>Record that the applicant asked to stop texts? This cannot be undone.</span>
          <BaseButton size="sm" variant="secondary" :disabled="stop.isPending.value" @click="recordStop">
            {{ stop.isPending.value ? "Recording…" : "Record stop" }}
          </BaseButton>
          <BaseButton size="sm" variant="ghost" :disabled="stop.isPending.value" @click="confirming = false">
            Cancel
          </BaseButton>
        </template>
        <BaseButton v-else size="sm" variant="ghost" @click="confirming = true">They asked to stop texts</BaseButton>
      </div>
    </template>
    <p v-else>
      <span class="font-medium text-ink">Texts:</span> stopped {{ formatDate(s.revokedAt) }}. Do not ask
      them to turn texts back on; they can do it themselves from their link.
    </p>
  </div>
</template>
