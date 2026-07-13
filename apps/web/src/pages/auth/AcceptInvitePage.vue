<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import { useSessionStore } from "@/stores/session";
import FormField from "@/components/ui/FormField.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import BaseButton from "@/components/ui/BaseButton.vue";

// Reached via a Supabase invite email link (type=invite) OR a password-recovery email
// (type=recovery, used when re-inviting a user whose email was already confirmed). Either way
// a session is established by the Supabase client before this page renders (requiresAuth: true
// on the route). The user sets a password, then we create their membership.
const session = useSessionStore();
const router = useRouter();

// If for any reason the session is missing (expired / already-used link slipped past the router),
// show a friendly error instead of a broken password form.
const hasSession = computed(() => !!session.session);

const password = ref("");
const confirm = ref("");
const error = ref<string | null>(null);
const loading = ref(false);

async function onSubmit() {
  error.value = null;
  if (password.value.length < 8) {
    error.value = "Password must be at least 8 characters.";
    return;
  }
  if (password.value !== confirm.value) {
    error.value = "Passwords do not match.";
    return;
  }
  loading.value = true;
  try {
    const { error: pwErr } = await supabase.auth.updateUser({ password: password.value });
    if (pwErr) throw pwErr;

    const res = await apiFetch("/api/invites/accept", { method: "POST", body: {} });
    if (!res.ok) {
      throw new Error(res.error?.message ?? "Could not accept the invitation.");
    }

    await session.refresh(); // pick up org_id / user_role claims (audit B3)
    router.push("/");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Something went wrong.";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div>
    <template v-if="!hasSession">
      <h2 class="mb-1 text-lg font-semibold text-ink">Link expired</h2>
      <p class="text-sm text-ink-muted">
        This invitation link has already been used or has expired. Please ask your administrator to
        resend the invitation.
      </p>
    </template>

    <template v-else>
    <h2 class="mb-1 text-lg font-semibold text-ink">Set your password</h2>
    <p class="mb-6 text-sm text-ink-muted">Finish setting up your FuelGuard account.</p>

    <form class="space-y-5" @submit.prevent="onSubmit">
      <FormField id="pw" label="New password" v-slot="{ id }">
        <BaseInput :id="id" v-model="password" type="password" autocomplete="new-password" required />
      </FormField>
      <FormField id="cf" label="Confirm password" v-slot="{ id }">
        <BaseInput :id="id" v-model="confirm" type="password" autocomplete="new-password" required />
      </FormField>

      <p v-if="error" class="text-sm text-danger-600">{{ error }}</p>

      <BaseButton type="submit" variant="primary" block :disabled="loading">
        {{ loading ? "Saving…" : "Set password & continue" }}
      </BaseButton>
    </form>
    </template>
  </div>
</template>
