<script setup lang="ts">
import { computed, ref } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { AppButton, AppCallout, AppCard, AppInput, AppSelect, useConfirm } from "@silvicom/ui";
import { ApiRequestError, apiPost, type OrgMember } from "@/lib/api";

/**
 * "Remove a member's two-step sign-in" on a customer's page (INSTALLED-APP-PLAN IA-S1; Q-IA11 (b)).
 *
 * For the customer with nobody else to ask: their only admin lost the phone with their authenticator app and
 * cannot sign in. Another admin of the same company can do this themselves in the office app; this card is
 * the way back in when there is none.
 *
 * The REASON is the control. The person asking cannot prove who they are the usual way — that is the whole
 * problem — so what the operator did to identify them is written down, required, and recorded in the platform
 * log; the customer's own audit trail says Silvicom did it. The card says what happens before it happens,
 * and asks once more, because it takes a protection off somebody's account.
 */
const props = defineProps<{ orgId: string; members: readonly OrgMember[] }>();

const ask = useConfirm();
const userId = ref("");
const reason = ref("");
const done = ref<string | null>(null);
const failure = ref<string | null>(null);
const options = computed(() => [
  { value: "", label: "Choose a member…" },
  ...props.members.filter((m) => m.role !== "driver").map((m) => ({ value: m.userId, label: `${m.email ?? m.userId} · ${m.role.replace("_", " ")}` })),
]);
const chosen = computed(() => props.members.find((m) => m.userId === userId.value) ?? null);
const ready = computed(() => chosen.value !== null && reason.value.trim().length >= 10);

const remove = useMutation({
  mutationFn: () => apiPost<{ removed: boolean; sessionsEnded: boolean }>(`/admin/orgs/${props.orgId}/members/${userId.value}/second-factor/remove`, { reason: reason.value.trim() }),
});

async function submit() {
  const member = chosen.value;
  if (!member || !ready.value) return;
  done.value = null;
  failure.value = null;
  const who = member.email ?? "this member";
  const yes = await ask({
    title: `Remove two-step sign-in for ${who}?`,
    message: "Their authenticator app stops working for this account and they are signed out on every device. They sign in next with their password alone. Do this only for somebody you have identified.",
    confirmLabel: "Remove",
    tone: "danger",
  });
  if (!yes) return;
  try {
    const res = await remove.mutateAsync();
    done.value = res.sessionsEnded
      ? `Removed. ${who} is signed out everywhere and signs in with their password next.`
      : `Removed, but ${who} could not be signed out of their devices. Ask an admin of the customer to sign them out.`;
    userId.value = "";
    reason.value = "";
  } catch (e) {
    failure.value =
      e instanceof ApiRequestError && e.code === "step_up_required"
        ? "This needs a fresh authenticator code of your own. Sign out and sign in again, then retry."
        : e instanceof ApiRequestError && e.code === "no_second_factor"
          ? `${who} has no two-step sign-in set up, so there is nothing to remove.`
          : e instanceof ApiRequestError && e.status === 403
            ? "Only a platform owner or admin can do this."
            : "Could not remove two-step sign-in.";
  }
}
</script>

<template>
  <AppCard>
    <h2 class="text-sm font-semibold text-ink-secondary">Remove a member's two-step sign-in</h2>
    <p class="mt-1 text-sm text-ink-muted">
      For somebody who has lost the phone with their authenticator app and has no other admin at their company to ask.
      The reason is required and recorded in the platform log; the customer's own audit trail shows Silvicom did it.
    </p>
    <form class="mt-3 space-y-3" @submit.prevent="submit">
      <AppSelect v-model="userId" aria-label="Member" :options="options" />
      <AppInput v-model="reason" aria-label="Reason" placeholder="Who asked, and how you confirmed it was them" />
      <AppCallout v-if="failure" tone="danger" role="alert">{{ failure }}</AppCallout>
      <AppCallout v-if="done" tone="success" role="status">{{ done }}</AppCallout>
      <AppButton type="submit" variant="danger" :disabled="!ready || remove.isPending.value">
        {{ remove.isPending.value ? "Removing…" : "Remove two-step sign-in" }}
      </AppButton>
    </form>
  </AppCard>
</template>
