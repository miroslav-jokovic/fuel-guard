<script setup lang="ts">
import { AppIcon } from "@fuelguard/ui";
import {
  CopyIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  EyeSlashIcon,
  KeyIcon,
  NoSymbolIcon,
  ResetPasswordIcon,
  ShieldCheckIcon,
  TrashIcon,
} from "@fuelguard/ui/icons";
import { computed, ref, watch } from "vue";
import {
  driverAppAccess,
  isValidDriverUsername,
  usernameFromName,
  type Driver,
  type DriverCredentialIssued,
} from "@fuelguard/shared";
import { useToastStore } from "@/stores/toast";
import SlideOver from "@/components/SlideOver.vue";
import { AppButton as BaseButton } from "@fuelguard/ui";
import { AppInput as BaseInput } from "@fuelguard/ui";
import { AppFormField as FormField } from "@fuelguard/ui";
import DriverAccountAccessControl from "./DriverAccountAccessControl.vue";
import DriverAccessSummary from "./DriverAccessSummary.vue";
import DriverCredentialHandoff from "./DriverCredentialHandoff.vue";
import {
  useCreateDriverLogin,
  useResetDriverPassword,
  useDisableDriverLogin,
  useEnableDriverLogin,
  useRevokeDriverLogin,
} from "./useDriverCredentials";

/**
 * App-account lifecycle for one driver. Create/reset credentials only live in this component while
 * the drawer is open: the API returns the password once and Silvicom 360 never stores it.
 */
const props = defineProps<{ open: boolean; driver: Driver | null }>();
const emit = defineEmits<{ (e: "close"): void }>();

const toast = useToastStore();
const create = useCreateDriverLogin();
const reset = useResetDriverPassword();
const disable = useDisableDriverLogin();
const enable = useEnableDriverLogin();
const revoke = useRevokeDriverLogin();

type ConfirmAction = "reset" | "disable" | "revoke" | "discard";

const username = ref("");
const customPassword = ref("");
const issued = ref<DriverCredentialIssued | null>(null);
const confirmAction = ref<ConfirmAction | null>(null);
const showCustomPassword = ref(false);
const showIssuedPassword = ref(false);

const access = computed(() =>
  props.driver ? driverAppAccess(props.driver.user_id, props.driver.app_access_enabled) : "none",
);
const busy = computed(
  () =>
    create.isPending.value ||
    reset.isPending.value ||
    disable.isPending.value ||
    enable.isPending.value ||
    revoke.isPending.value,
);

watch(
  () => [props.open, props.driver?.id],
  () => {
    username.value = props.driver
      ? (props.driver.app_username ??
        props.driver.samsara_username ??
        usernameFromName(props.driver.full_name))
      : "";
    customPassword.value = "";
    issued.value = null;
    confirmAction.value = null;
    showCustomPassword.value = false;
    showIssuedPassword.value = false;
  },
  { immediate: true },
);

const usernameProblem = computed(() => {
  const value = username.value.trim().toLowerCase();
  if (!value) return "Username is required.";
  if (!isValidDriverUsername(value)) {
    return "Use 3–32 lowercase letters, numbers, periods, dashes, or underscores.";
  }
  return null;
});

const passwordProblem = computed(() => {
  const value = customPassword.value;
  if (!value) return null;
  if (value.length < 12) return "Password must be at least 12 characters.";
  if (value.length > 128) return "Password must be 128 characters or fewer.";
  return null;
});

const confirmation = computed(() => {
  const driverName = props.driver?.full_name ?? "this driver";
  switch (confirmAction.value) {
    case "reset":
      return {
        icon: ResetPasswordIcon,
        tone: "warning" as const,
        title: "Reset this password?",
        body: `${driverName}'s current password will stop working immediately. You will need to hand them the new password shown next.`,
        confirmLabel: "Reset password",
      };
    case "disable":
      return {
        icon: NoSymbolIcon,
        tone: "warning" as const,
        title: "Disable app access?",
        body: `${driverName} will be signed out and blocked from signing in until you enable access again.`,
        confirmLabel: "Disable app access",
      };
    case "revoke":
      return {
        icon: TrashIcon,
        tone: "danger" as const,
        title: "Revoke this login?",
        body: `${driverName}'s app account will be permanently deleted. Their driver record and history will stay intact.`,
        confirmLabel: "Revoke login",
      };
    case "discard":
      return {
        icon: ExclamationTriangleIcon,
        tone: "danger" as const,
        title: "Close without saving?",
        body: "This password cannot be shown again. Make sure you copied or handed off the login details before closing.",
        confirmLabel: "Close anyway",
      };
    default:
      return null;
  }
});

function close() {
  if (busy.value) return;
  if (issued.value) {
    confirmAction.value = "discard";
    return;
  }
  confirmAction.value = null;
  emit("close");
}

function finishCredentialHandoff() {
  issued.value = null;
  emit("close");
}

async function createLogin() {
  const driver = props.driver;
  if (!driver || usernameProblem.value || passwordProblem.value) return;
  try {
    issued.value = await create.mutateAsync({
      driverId: driver.id,
      username: username.value.trim().toLowerCase(),
      password: customPassword.value || undefined,
    });
    customPassword.value = "";
    showCustomPassword.value = false;
    toast.success("Driver login created", "Copy the one-time credentials before closing.");
  } catch (error) {
    toast.error("Could not create login", error instanceof Error ? error.message : undefined);
  }
}

async function enableLogin() {
  const driver = props.driver;
  if (!driver) return;
  try {
    await enable.mutateAsync(driver.id);
    toast.success("App access enabled", `${driver.full_name} can sign in again.`);
  } catch (error) {
    toast.error("Could not enable access", error instanceof Error ? error.message : undefined);
  }
}

function askToConfirm(action: Exclude<ConfirmAction, "discard">) {
  if (action === "reset" && passwordProblem.value) return;
  confirmAction.value = action;
}

async function runConfirmedAction() {
  const driver = props.driver;
  const action = confirmAction.value;
  if (!driver || !action) return;

  if (action === "discard") {
    issued.value = null;
    confirmAction.value = null;
    emit("close");
    return;
  }

  try {
    if (action === "reset") {
      issued.value = await reset.mutateAsync({
        driverId: driver.id,
        password: customPassword.value || undefined,
      });
      customPassword.value = "";
      showCustomPassword.value = false;
      showIssuedPassword.value = false;
      toast.success("Password reset", "Copy the new one-time credentials before closing.");
    }
    if (action === "disable") {
      await disable.mutateAsync(driver.id);
      toast.success("App access disabled", `${driver.full_name} has been signed out.`);
    }
    if (action === "revoke") {
      await revoke.mutateAsync(driver.id);
      toast.success("Driver login revoked", "The driver record and history were not changed.");
      emit("close");
    }
    confirmAction.value = null;
  } catch (error) {
    toast.error("Action failed", error instanceof Error ? error.message : undefined);
  }
}

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Could not copy", "Select the value and copy it manually.");
  }
}

async function copyCredentials() {
  if (!issued.value) return;
  await copy(
    `FuelGuard Driver app\nUsername: ${issued.value.username}\nPassword: ${issued.value.password}`,
    "Login details",
  );
}
</script>

<template>
  <SlideOver
    :open="open"
    title="Manage app login"
    :description="driver?.full_name"
    size="lg"
    @close="close"
  >
    <div v-if="driver">
      <!-- Confirmation replaces the drawer body so the decision is focused and reversible. -->
      <div
        v-if="confirmation"
        class="flex min-h-[26rem] flex-col items-center justify-center text-center"
      >
        <div
          class="flex size-12 items-center justify-center rounded-full"
          :class="
            confirmation.tone === 'danger'
              ? 'bg-danger-100 text-danger-700'
              : 'bg-warning-100 text-warning-700'
          "
        >
          <AppIcon :icon="confirmation.icon" class="size-6" aria-hidden="true" />
        </div>
        <h3 class="mt-4 text-base font-semibold text-ink">{{ confirmation.title }}</h3>
        <p class="mt-2 max-w-sm text-sm leading-6 text-ink-muted">{{ confirmation.body }}</p>
      </div>

      <!-- A one-time handoff view appears after create/reset and keeps secondary actions out of sight. -->
      <DriverCredentialHandoff
        v-else-if="issued"
        v-model:show-password="showIssuedPassword"
        :credential="issued"
        @copy="copy"
      />

      <div v-else class="space-y-6">
        <!-- Current account summary -->
        <DriverAccessSummary :driver="driver" :access="access" />

        <!-- Create-login setup -->
        <form
          v-if="access === 'none'"
          id="driver-login-form"
          aria-labelledby="create-login-heading"
          @submit.prevent="createLogin"
        >
          <h3 id="create-login-heading" class="text-sm font-semibold text-ink">Login details</h3>
          <p class="mt-1 text-sm text-ink-muted">
            The suggested username is based on this driver's roster details.
          </p>
          <div class="mt-4 space-y-4">
            <FormField
              v-slot="{ id }"
              label="Username"
              required
              :error="usernameProblem ?? undefined"
              hint="3–32 lowercase letters, numbers, periods, dashes, or underscores."
            >
              <BaseInput
                :id="id"
                v-model="username"
                name="username"
                autocapitalize="none"
                autocomplete="off"
                spellcheck="false"
                :invalid="!!usernameProblem"
                class="font-mono"
              />
            </FormField>

            <FormField
              v-slot="{ id }"
              label="Custom password"
              :error="passwordProblem ?? undefined"
              hint="Optional. Leave blank and Silvicom 360 will generate a strong password."
            >
              <div class="relative">
                <BaseInput
                  :id="id"
                  v-model="customPassword"
                  name="password"
                  :type="showCustomPassword ? 'text' : 'password'"
                  autocomplete="new-password"
                  placeholder="Generate automatically"
                  :invalid="!!passwordProblem"
                  class="pr-12 font-mono"
                />
                <BaseButton
                  variant="ghost"
                  size="sm"
                  class="absolute inset-y-0 right-1 my-auto px-2"
                  :aria-label="showCustomPassword ? 'Hide custom password' : 'Show custom password'"
                  @click="showCustomPassword = !showCustomPassword"
                >
                  <AppIcon
                    :icon="showCustomPassword ? EyeSlashIcon : EyeIcon"
                    class="size-4"
                    aria-hidden="true"
                  />
                </BaseButton>
              </div>
            </FormField>
          </div>
        </form>

        <template v-else>
          <!-- Temporary access control is separated from credential rotation. -->
          <DriverAccountAccessControl
            :access="access"
            :busy="busy"
            :enabling="enable.isPending.value"
            @disable="askToConfirm('disable')"
            @enable="enableLogin"
          />

          <form
            id="driver-password-reset-form"
            aria-labelledby="password-reset-heading"
            @submit.prevent="askToConfirm('reset')"
          >
            <h3 id="password-reset-heading" class="text-sm font-semibold text-ink">
              Reset password
            </h3>
            <p class="mt-1 text-sm leading-5 text-ink-muted">
              Resetting immediately replaces the current password. A new one is shown once after
              confirmation.
            </p>
            <FormField
              v-slot="{ id }"
              class="mt-4"
              label="Custom password"
              :error="passwordProblem ?? undefined"
              hint="Optional. Leave blank to generate a strong password."
            >
              <div class="relative">
                <BaseInput
                  :id="id"
                  v-model="customPassword"
                  name="reset-password"
                  :type="showCustomPassword ? 'text' : 'password'"
                  autocomplete="new-password"
                  placeholder="Generate automatically"
                  :invalid="!!passwordProblem"
                  class="pr-12 font-mono"
                />
                <BaseButton
                  variant="ghost"
                  size="sm"
                  class="absolute inset-y-0 right-1 my-auto px-2"
                  :aria-label="showCustomPassword ? 'Hide custom password' : 'Show custom password'"
                  @click="showCustomPassword = !showCustomPassword"
                >
                  <AppIcon
                    :icon="showCustomPassword ? EyeSlashIcon : EyeIcon"
                    class="size-4"
                    aria-hidden="true"
                  />
                </BaseButton>
              </div>
            </FormField>
          </form>

          <section aria-labelledby="danger-zone-heading">
            <h3 id="danger-zone-heading" class="text-sm font-semibold text-danger-700">
              Danger zone
            </h3>
            <div class="mt-3 rounded-surface border border-danger-200 bg-danger-50 p-4">
              <div class="flex items-start gap-3">
                <AppIcon
                  :icon="TrashIcon"
                  class="mt-0.5 size-5 shrink-0 text-danger-700"
                  aria-hidden="true"
                />
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-danger-800">Revoke app login</p>
                  <p class="mt-1 text-xs leading-5 text-danger-700">
                    Permanently delete the login. The driver record and operating history are not
                    removed.
                  </p>
                  <BaseButton
                    variant="danger"
                    size="sm"
                    class="mt-3"
                    :disabled="busy"
                    @click="askToConfirm('revoke')"
                  >
                    Revoke login
                  </BaseButton>
                </div>
              </div>
            </div>
          </section>

          <p class="flex items-center gap-2 text-xs text-ink-tertiary">
            <AppIcon :icon="ShieldCheckIcon" class="size-4 shrink-0" aria-hidden="true" />
            Every account action is recorded in the audit log.
          </p>
        </template>
      </div>
    </div>

    <template v-if="driver" #footer>
      <div v-if="confirmation" class="flex items-center justify-end gap-3">
        <BaseButton :disabled="busy" @click="confirmAction = null">Back</BaseButton>
        <BaseButton
          :variant="confirmation.tone === 'danger' ? 'danger' : 'primary'"
          :disabled="busy"
          @click="runConfirmedAction"
        >
          {{ busy ? "Working…" : confirmation.confirmLabel }}
        </BaseButton>
      </div>

      <div v-else-if="issued" class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <BaseButton @click="finishCredentialHandoff">Done</BaseButton>
        <BaseButton variant="primary" @click="copyCredentials">
          <AppIcon :icon="CopyIcon" class="size-4" aria-hidden="true" /> Copy login details
        </BaseButton>
      </div>

      <div v-else-if="access === 'none'" class="flex items-center justify-end gap-3">
        <BaseButton :disabled="busy" @click="close">Cancel</BaseButton>
        <BaseButton
          form="driver-login-form"
          type="submit"
          variant="primary"
          :disabled="busy || !!usernameProblem || !!passwordProblem"
        >
          <AppIcon :icon="KeyIcon" class="size-4" aria-hidden="true" />
          {{ create.isPending.value ? "Creating…" : "Create app login" }}
        </BaseButton>
      </div>

      <div v-else class="flex items-center justify-end gap-3">
        <BaseButton :disabled="busy" @click="close">Close</BaseButton>
        <BaseButton
          form="driver-password-reset-form"
          type="submit"
          variant="primary"
          :disabled="busy || !!passwordProblem"
        >
          <AppIcon :icon="ResetPasswordIcon" class="size-4" aria-hidden="true" /> Reset password
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
