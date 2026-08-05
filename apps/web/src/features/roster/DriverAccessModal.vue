<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { driverAppAccess, usernameFromName, type Driver, type DriverCredentialIssued } from "@fuelguard/shared";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { useToastStore } from "@/stores/toast";
import SlideOver from "@/components/SlideOver.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import {
  useCreateDriverLogin,
  useResetDriverPassword,
  useDisableDriverLogin,
  useEnableDriverLogin,
  useRevokeDriverLogin,
} from "./useDriverCredentials";

/**
 * App-access lifecycle for one driver (DRIVER-CREDENTIALS-PLAN.md): create / reset / disable /
 * enable / revoke the company-issued login. The generated password appears ONLY here, once, right
 * after create/reset — it is never stored anywhere, so the admin must hand it to the driver now.
 */
const props = defineProps<{ open: boolean; driver: Driver | null }>();
const emit = defineEmits<{ (e: "close"): void }>();

const toast = useToastStore();
const create = useCreateDriverLogin();
const reset = useResetDriverPassword();
const disable = useDisableDriverLogin();
const enable = useEnableDriverLogin();
const revoke = useRevokeDriverLogin();

const access = computed(() =>
  props.driver ? driverAppAccess(props.driver.user_id, props.driver.app_access_enabled) : "none",
);
const busy = computed(
  () =>
    create.isPending.value || reset.isPending.value || disable.isPending.value ||
    enable.isPending.value || revoke.isPending.value,
);

// Username input (create only) — prefilled with the natural default; the server validates + dedups.
const username = ref("");
// Optional admin-chosen password (create AND reset). Blank → the server generates a strong one.
const customPassword = ref("");
watch(
  () => [props.open, props.driver?.id],
  () => {
    username.value = props.driver
      ? (props.driver.app_username ?? props.driver.samsara_username ?? usernameFromName(props.driver.full_name))
      : "";
    customPassword.value = "";
    issued.value = null;
  },
);

/** Client-side mirror of the contract rule (12–128 chars) so a too-short choice fails before the API. */
const passwordProblem = computed(() => {
  const p = customPassword.value;
  if (!p) return null;
  if (p.length < 12) return "Custom password must be at least 12 characters.";
  if (p.length > 128) return "Custom password is too long.";
  return null;
});

// The one-time credential — lives only in this ref while the modal is open.
const issued = ref<DriverCredentialIssued | null>(null);

async function run(action: "create" | "reset" | "disable" | "enable" | "revoke") {
  const d = props.driver;
  if (!d) return;
  if ((action === "create" || action === "reset") && passwordProblem.value) {
    toast.error(passwordProblem.value);
    return;
  }
  const chosen = customPassword.value || undefined;
  try {
    if (action === "create")
      issued.value = await create.mutateAsync({ driverId: d.id, username: username.value.trim() || undefined, password: chosen });
    if (action === "reset" && confirm(`Reset ${d.full_name}'s app password? Their current password stops working.`))
      issued.value = await reset.mutateAsync({ driverId: d.id, password: chosen });
    if (action === "disable" && confirm(`Disable ${d.full_name}'s app access? They are signed out and cannot sign back in until re-enabled.`))
      await disable.mutateAsync(d.id);
    if (action === "enable") await enable.mutateAsync(d.id);
    if (action === "revoke" && confirm(`Permanently remove ${d.full_name}'s app login? This deletes the account; a new login can be issued later.`))
      await revoke.mutateAsync(d.id);
  } catch (e) {
    toast.error("Action failed", e instanceof Error ? e.message : undefined);
  }
}

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Could not copy — select and copy manually");
  }
}

function close() {
  issued.value = null; // the one-time password dies with the modal
  emit("close");
}
</script>

<template>
  <SlideOver :open="open" :title="driver ? `App access — ${driver.full_name}` : 'App access'" @close="close">
    <div v-if="driver" class="space-y-6">
      <!-- Current state -->
      <div class="flex items-center gap-2">
        <span
          :class="[BADGE_BASE, access === 'active' ? toneClass('success') : access === 'disabled' ? toneClass('warning') : toneClass('neutral')]"
          >{{ access === "active" ? "Active" : access === "disabled" ? "Disabled" : "No login" }}</span
        >
        <span v-if="driver.app_username" class="text-sm text-ink-secondary">
          Username: <span class="font-mono font-medium text-ink">{{ driver.app_username }}</span>
        </span>
      </div>

      <!-- One-time credential (right after create/reset) -->
      <div v-if="issued" class="rounded-lg border border-warning-300 bg-warning-50 p-4">
        <p class="text-sm font-semibold text-warning-800">
          Hand these to the driver now — the password is shown only once and is not stored anywhere.
        </p>
        <dl class="mt-3 space-y-2 text-sm">
          <div class="flex items-center justify-between gap-3">
            <div><dt class="text-xs text-ink-muted uppercase">Username</dt><dd class="font-mono font-medium text-ink">{{ issued.username }}</dd></div>
            <BaseButton variant="ghost" size="sm" @click="copy(issued.username, 'Username')">Copy</BaseButton>
          </div>
          <div class="flex items-center justify-between gap-3">
            <div><dt class="text-xs text-ink-muted uppercase">Password</dt><dd class="font-mono font-medium text-ink">{{ issued.password }}</dd></div>
            <BaseButton variant="ghost" size="sm" @click="copy(issued.password, 'Password')">Copy</BaseButton>
          </div>
        </dl>
      </div>

      <!-- Actions by state -->
      <div v-if="access === 'none'" class="space-y-3">
        <p class="text-sm text-ink-muted">
          Create this driver's app login. You choose the username; the password is generated and shown
          once. Drivers cannot change or recover it themselves — resets go through you.
        </p>
        <label class="block text-sm">
          <span class="text-ink-secondary">Username</span>
          <input
            v-model="username"
            type="text"
            autocapitalize="none"
            autocomplete="off"
            spellcheck="false"
            class="mt-1 w-full rounded-md border-edge font-mono text-sm"
          />
        </label>
        <label class="block text-sm">
          <span class="text-ink-secondary">Custom password <span class="text-ink-subtle">(optional — blank generates one)</span></span>
          <input
            v-model="customPassword"
            type="text"
            autocapitalize="none"
            autocomplete="off"
            spellcheck="false"
            placeholder="min 12 characters"
            class="mt-1 w-full rounded-md border-edge font-mono text-sm"
          />
          <span v-if="passwordProblem" class="mt-1 block text-xs text-danger-600">{{ passwordProblem }}</span>
        </label>
        <BaseButton variant="primary" :disabled="busy || !!passwordProblem" @click="run('create')">Create login</BaseButton>
      </div>

      <div v-else class="space-y-3">
        <label class="block text-sm">
          <span class="text-ink-secondary">Custom password for reset <span class="text-ink-subtle">(optional — blank generates one)</span></span>
          <input
            v-model="customPassword"
            type="text"
            autocapitalize="none"
            autocomplete="off"
            spellcheck="false"
            placeholder="min 12 characters"
            class="mt-1 w-full rounded-md border-edge font-mono text-sm"
          />
          <span v-if="passwordProblem" class="mt-1 block text-xs text-danger-600">{{ passwordProblem }}</span>
        </label>
        <div class="flex flex-wrap gap-2">
          <BaseButton variant="secondary" :disabled="busy || !!passwordProblem" @click="run('reset')">Reset password</BaseButton>
          <BaseButton v-if="access === 'active'" variant="secondary" :disabled="busy" @click="run('disable')">Disable</BaseButton>
          <BaseButton v-if="access === 'disabled'" variant="primary" :disabled="busy" @click="run('enable')">Enable</BaseButton>
          <BaseButton variant="danger" :disabled="busy" @click="run('revoke')">Revoke login</BaseButton>
        </div>
      </div>

      <p class="text-xs text-ink-subtle">
        Disable signs the driver out and blocks sign-in until re-enabled. Revoke deletes the login
        entirely (the roster record is untouched); a new login can be issued any time. Every action is
        recorded in the audit log.
      </p>
    </div>
  </SlideOver>
</template>
