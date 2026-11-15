<script setup lang="ts">
import { ref } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { AppButton as BaseButton, AppInput as BaseInput } from "@silvicom/ui";
import { formatDisplayDate } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * "Send a documents link" on the office's review drawer (APPLICATION-FIX-PLAN.md, Q-AM19; 0608).
 *
 * One press mints a link that opens only the applicant's photo list and e-mails it to them. What the
 * office reads back is what it needs to act on: where it was e-mailed, or that it was not and the link
 * to read out or text by hand, and the day it stops working.
 *
 * ⚠ Every press is a NEW link, and the one before it stops working — said under the button, because an
 * office that presses twice "to be sure" has just broken the link in the applicant's inbox.
 *
 * The API decides when it may be sent (not before the applicant has started, not once the application
 * is filed) and says why in a sentence; this shows that sentence and restates no rule.
 */
const props = defineProps<{ invitationId: string }>();

interface Sent {
  link: string;
  expiresAt: string;
  delivery: { sent: boolean; email: string | null; reason: string | null };
}
const sent = ref<Sent | null>(null);
const problem = ref<string | null>(null);

const send = useMutation({
  mutationFn: async (): Promise<Sent> => {
    const res = await apiFetch<Sent>(
      `/api/recruitment/applications/${encodeURIComponent(props.invitationId)}/documents-link`, { method: "POST" },
    );
    if (!res.ok || !res.data) throw new Error(res.error?.message ?? "The link could not be sent.");
    return res.data;
  },
});

async function press(): Promise<void> {
  problem.value = null;
  try {
    sent.value = await send.mutateAsync();
  } catch (e) {
    sent.value = null;
    problem.value = (e as Error).message;
  }
}

/** Where the link went — or that it did not, and what to do with the link shown below. */
const told = (d: Sent["delivery"]): string => {
  if (d.sent) return `E-mailed to ${d.email}.`;
  if (d.reason === "no_address") return "Not e-mailed: there is no e-mail address on this application. Read or text them the link below.";
  return "The e-mail did not go. Read or text them the link below.";
};
</script>

<template>
  <section class="space-y-2" data-documents-link>
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="min-w-[12rem] flex-1">
        <h3 class="text-sm font-semibold text-ink">Documents only</h3>
        <p class="text-xs text-ink-muted">
          A link that opens only their photo list: no questions, nothing to sign. Each one you send replaces the last.
        </p>
      </div>
      <BaseButton size="sm" variant="secondary" :disabled="send.isPending.value" @click="press">
        {{ send.isPending.value ? "Sending…" : sent ? "Send a new link" : "Send a documents link" }}
      </BaseButton>
    </div>
    <div v-if="sent" class="space-y-2 rounded-surface bg-surface-muted p-3 text-sm" role="status" data-documents-link-sent>
      <p class="text-ink">{{ told(sent.delivery) }} It works until {{ formatDisplayDate(sent.expiresAt) }}.</p>
      <BaseInput :model-value="sent.link" readonly aria-label="The documents link" @focus="($event.target as HTMLInputElement).select()" />
    </div>
    <p v-if="problem" class="text-sm text-danger-700" role="alert">{{ problem }}</p>
  </section>
</template>
