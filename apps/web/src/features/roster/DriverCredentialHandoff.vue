<script setup lang="ts">
import { AppIcon } from "@silvicom/ui";
import {
  CheckCircleIcon,
  CopyIcon,
  DevicePhoneMobileIcon,
  EyeIcon,
  EyeSlashIcon,
} from "@silvicom/ui/icons";
import type { DriverCredentialIssued } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import { AppCard as BaseCard } from "@silvicom/ui";

defineProps<{
  credential: DriverCredentialIssued;
  showPassword: boolean;
}>();

const emit = defineEmits<{
  copy: [value: string, label: string];
  "update:showPassword": [value: boolean];
}>();
</script>

<template>
  <div class="space-y-6" aria-live="polite">
    <div class="rounded-surface bg-success-50 p-4 ring-1 ring-inset ring-success-200">
      <div class="flex gap-3">
        <AppIcon
          :icon="CheckCircleIcon"
          class="mt-0.5 size-5 shrink-0 text-success-700"
          aria-hidden="true"
        />
        <div>
          <h3 class="text-sm font-semibold text-success-800">Login ready to hand off</h3>
          <p class="mt-1 text-sm leading-5 text-success-700">
            Copy these details now. The password disappears when you close this drawer and cannot be
            recovered.
          </p>
        </div>
      </div>
    </div>

    <BaseCard padding="none">
      <dl class="divide-y divide-edge-subtle">
        <div class="px-4 py-4">
          <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">Username</dt>
          <dd class="mt-2 flex items-center justify-between gap-3">
            <span class="min-w-0 truncate font-mono text-sm font-semibold text-ink">
              {{ credential.username }}
            </span>
            <BaseButton
              variant="ghost"
              size="sm"
              @click="emit('copy', credential.username, 'Username')"
            >
              <AppIcon :icon="CopyIcon" class="size-4" aria-hidden="true" /> Copy
            </BaseButton>
          </dd>
        </div>
        <div class="px-4 py-4">
          <dt class="text-xs font-medium tracking-wide text-ink-muted uppercase">
            One-time password
          </dt>
          <dd class="mt-2 flex items-center justify-between gap-3">
            <span class="min-w-0 break-all font-mono text-sm font-semibold text-ink">
              {{ showPassword ? credential.password : "••••••••••••••••" }}
            </span>
            <div class="flex shrink-0 items-center gap-1">
              <BaseButton
                variant="ghost"
                size="sm"
                :aria-label="showPassword ? 'Hide password' : 'Show password'"
                @click="emit('update:showPassword', !showPassword)"
              >
                <AppIcon
                  :icon="showPassword ? EyeSlashIcon : EyeIcon"
                  class="size-4"
                  aria-hidden="true"
                />
                {{ showPassword ? "Hide" : "Show" }}
              </BaseButton>
              <BaseButton
                variant="ghost"
                size="sm"
                @click="emit('copy', credential.password, 'Password')"
              >
                <AppIcon :icon="CopyIcon" class="size-4" aria-hidden="true" /> Copy
              </BaseButton>
            </div>
          </dd>
        </div>
      </dl>
    </BaseCard>

    <div class="flex gap-3 rounded-surface bg-surface-subtle p-4 ring-1 ring-inset ring-edge">
      <AppIcon
        :icon="DevicePhoneMobileIcon"
        class="mt-0.5 size-5 shrink-0 text-ink-muted"
        aria-hidden="true"
      />
      <div>
        <h3 class="text-sm font-medium text-ink">Driver handoff</h3>
        <p class="mt-1 text-sm leading-5 text-ink-muted">
          Send both values through a trusted channel and ask the driver to sign in before you leave
          this screen.
        </p>
      </div>
    </div>
  </div>
</template>
