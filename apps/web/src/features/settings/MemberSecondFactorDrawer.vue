<script setup lang="ts">
import { ref } from "vue";
import type { OrgMember } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { apiRefusal, useStepUpRetry } from "@/composables/useStepUpRetry";
import { AppButton as BaseButton } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import StepUpPrompt from "@/components/StepUpPrompt.vue";
import { useToastStore } from "@/stores/toast";

/**
 * "Remove two-step sign-in…" on the Users page (INSTALLED-APP-PLAN IA-S1; Q-IA11 (a)): for the member whose
 * phone was lost, broken or replaced, and who therefore cannot produce a code.
 *
 * A drawer on MemberPasswordResetDrawer's reasoning: it says what the act DOES before it happens — their
 * authenticator stops working, they are signed out on every device, and their next sign-in is password only
 * until they set a new one up. The API asks for the admin's password first (`requireFreshAuth`); the prompt
 * replaces the drawer body and the same removal re-runs once it is given.
 */
const props = defineProps<{ member: OrgMember | null }>();
const emit = defineEmits<{ close: [] }>();

const toast = useToastStore();
const busy = ref(false);
const { stepUpFor, holdForStepUp, confirmed, cancel } = useStepUpRetry();

async function remove(): Promise<void> {
  const m = props.member;
  if (!m) return;
  busy.value = true;
  try {
    const res = await apiFetch<{ removed: boolean }>(`/api/members/${m.userId}/second-factor`, { method: "DELETE" });
    if (!res.ok) throw apiRefusal(res.error, "Could not remove two-step sign-in.");
    toast.success("Two-step sign-in removed", `${m.fullName ?? m.email ?? "The member"} is signed out everywhere and signs in with their password next.`);
    emit("close");
  } catch (e) {
    if (holdForStepUp(e, remove)) return;
    toast.error("Could not remove two-step sign-in", e instanceof Error ? e.message : undefined);
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
  <SlideOver :open="member !== null" title="Remove two-step sign-in" :description="member?.email ?? undefined" @close="close">
    <StepUpPrompt v-if="stepUpFor" :reason="stepUpFor" @confirmed="confirmed" @cancel="cancel" />
    <div v-else class="space-y-3 text-sm text-ink-secondary">
      <p>Use this when {{ member?.fullName ?? member?.email }} cannot get a code — their phone was lost, broken or replaced.</p>
      <p>Their authenticator app stops working for this account and they are signed out on every device. They sign in next with their password alone.</p>
      <p>If they are an admin, they are asked to set a new authenticator up before the app opens.</p>
    </div>
    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton :disabled="busy" @click="close">Cancel</BaseButton>
        <BaseButton variant="danger" :disabled="busy || stepUpFor !== null" @click="remove">{{ busy ? "Removing…" : "Remove two-step sign-in" }}</BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
