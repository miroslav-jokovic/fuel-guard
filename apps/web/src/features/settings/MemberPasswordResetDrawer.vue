<script setup lang="ts">
import { ref } from "vue";
import { PASSWORD_RESET_TTL_MINUTES, type AdminPasswordResetResult, type OrgMember } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { apiRefusal, useStepUpRetry } from "@/composables/useStepUpRetry";
import { AppButton as BaseButton } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import StepUpPrompt from "@/components/StepUpPrompt.vue";
import { useToastStore } from "@/stores/toast";

/**
 * "Send password reset…" on the Users page (0363, D-PWR8).
 *
 * A drawer and not a one-click kebab item, because the drawer can say what the action DOES before
 * it happens: the person gets an email, the admin never sees the link, and once it is used every
 * device they are signed in on is signed out. The API asks for the admin's password first
 * (`requireFreshAuth`); the prompt replaces the drawer body and the send re-runs once it is given.
 */
const props = defineProps<{ member: OrgMember | null }>();
const emit = defineEmits<{ close: [] }>();

const toast = useToastStore();
const busy = ref(false);
const { stepUpFor, holdForStepUp, confirmed, cancel } = useStepUpRetry();

async function send(): Promise<void> {
  const m = props.member;
  if (!m) return;
  busy.value = true;
  try {
    const res = await apiFetch<AdminPasswordResetResult>(`/api/members/${m.userId}/password-reset`, { method: "POST" });
    if (!res.ok) throw apiRefusal(res.error, "Could not send the reset email.");
    toast.success("Reset email sent", `${m.email ?? "The member"} has ${PASSWORD_RESET_TTL_MINUTES} minutes to use it.`);
    emit("close");
  } catch (e) {
    if (holdForStepUp(e, send)) return;
    toast.error("Could not send reset email", e instanceof Error ? e.message : undefined);
  } finally {
    busy.value = false;
  }
}

function close(): void {
  cancel();
  emit("close");
}
</script>

<template>
  <SlideOver :open="member !== null" title="Send password reset" :description="member?.email ?? undefined" @close="close">
    <StepUpPrompt v-if="stepUpFor" :reason="stepUpFor" @confirmed="confirmed" @cancel="cancel" />
    <div v-else class="space-y-3 text-sm text-ink-secondary">
      <p>
        {{ member?.fullName ?? member?.email }} gets an email with a link to choose a new password. It works once, for
        {{ PASSWORD_RESET_TTL_MINUTES }} minutes, and replaces any reset link sent before.
      </p>
      <p>You won't see the link or the new password. When it's used, every device they're signed in on is signed out.</p>
    </div>
    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton :disabled="busy" @click="close">Cancel</BaseButton>
        <BaseButton variant="primary" :disabled="busy || stepUpFor !== null" @click="send">
          {{ busy ? "Sending…" : "Send reset email" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
