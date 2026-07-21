<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { AppButton, AppInput, AppCard } from "@fuelguard/ui";
import { supabase } from "@/lib/supabase";
import { useSessionStore } from "@/stores/session";

const session = useSessionStore();
const router = useRouter();

type Mode = "loading" | "enroll" | "challenge";
const mode = ref<Mode>("loading");
const factorId = ref<string | null>(null);
const qrSvg = ref<string | null>(null); // data-URL SVG for the authenticator QR (enroll only)
const secret = ref<string | null>(null);
const code = ref("");
const error = ref<string | null>(null);
const busy = ref(false);

async function done() {
  await session.refresh();
  await router.push({ name: "dashboard" });
}

onMounted(async () => {
  try {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === "aal2") return done();

    const { data: factors, error: listErr } = await supabase.auth.mfa.listFactors();
    if (listErr) throw listErr;
    const verified = (factors?.totp ?? []).filter((f) => f.status === "verified");

    if (verified.length > 0) {
      factorId.value = verified[0]!.id;
      mode.value = "challenge";
      return;
    }
    // No verified factor yet → enroll a new TOTP factor.
    const { data: enrolled, error: enrollErr } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    if (enrollErr) throw enrollErr;
    factorId.value = enrolled.id;
    qrSvg.value = enrolled.totp.qr_code;
    secret.value = enrolled.totp.secret;
    mode.value = "enroll";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Could not start MFA";
    mode.value = "challenge";
  }
});

async function verify() {
  if (!factorId.value) return;
  error.value = null;
  busy.value = true;
  try {
    const { error: vErr } = await supabase.auth.mfa.challengeAndVerify({
      factorId: factorId.value,
      code: code.value.trim(),
    });
    if (vErr) throw vErr;
    await done();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Invalid code";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-full items-center justify-center px-4 py-16">
    <AppCard class="w-full max-w-sm">
      <h1 class="text-lg font-semibold text-ink">Two-factor authentication</h1>
      <p class="mt-1 text-sm text-ink-muted">
        {{ mode === "enroll" ? "Scan this with your authenticator app, then enter the 6-digit code." : "Enter the 6-digit code from your authenticator app." }}
      </p>

      <div v-if="mode === 'loading'" class="mt-6 text-sm text-ink-muted">Loading…</div>

      <template v-else>
        <div v-if="mode === 'enroll' && qrSvg" class="mt-4 flex flex-col items-center gap-2">
          <img :src="qrSvg" alt="Authenticator QR code" class="h-44 w-44" />
          <code v-if="secret" class="rounded bg-surface-muted px-2 py-1 text-xs text-ink-secondary">{{ secret }}</code>
        </div>

        <form class="mt-5 space-y-4" @submit.prevent="verify">
          <AppInput
            v-model="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder="123456"
            maxlength="6"
            required
          />
          <p v-if="error" class="text-sm text-danger-600">{{ error }}</p>
          <AppButton type="submit" variant="primary" block :disabled="busy">
            {{ busy ? "Verifying…" : "Verify" }}
          </AppButton>
        </form>
      </template>
    </AppCard>
  </div>
</template>
