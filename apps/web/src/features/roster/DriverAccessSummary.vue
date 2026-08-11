<script setup lang="ts">
import { AppIcon } from "@fuelguard/ui";
import { DevicePhoneMobileIcon, KeyIcon } from "@fuelguard/ui/icons";
import type { Driver, DriverAppAccess } from "@fuelguard/shared";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { AppCard as BaseCard } from "@fuelguard/ui";

defineProps<{
  driver: Driver;
  access: DriverAppAccess;
}>();
</script>

<template>
  <BaseCard padding="none">
    <div class="flex items-start gap-3 p-4">
      <div
        class="flex size-10 shrink-0 items-center justify-center rounded-surface"
        :class="
          access === 'active'
            ? 'bg-success-50 text-success-700'
            : access === 'disabled'
              ? 'bg-warning-50 text-warning-700'
              : 'bg-brand-50 text-brand-700'
        "
      >
        <AppIcon
          :icon="access === 'none' ? KeyIcon : DevicePhoneMobileIcon"
          class="size-5"
          aria-hidden="true"
        />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="text-sm font-semibold text-ink">
            {{ access === "none" ? "No app login" : "FuelGuard Driver app" }}
          </h3>
          <span
            :class="[
              BADGE_BASE,
              access === 'active'
                ? toneClass('success')
                : access === 'disabled'
                  ? toneClass('warning')
                  : toneClass('neutral'),
            ]"
          >
            {{ access === "active" ? "Active" : access === "disabled" ? "Disabled" : "Not set up" }}
          </span>
        </div>
        <p class="mt-1 text-sm leading-5 text-ink-muted">
          {{
            access === "active"
              ? "This driver can sign in and use the mobile app."
              : access === "disabled"
                ? "Sign-in is paused until access is enabled again."
                : "Create a company-managed username and password for this driver."
          }}
        </p>
      </div>
    </div>
    <div v-if="driver.app_username" class="border-t border-edge-subtle px-4 py-3">
      <div class="flex items-center justify-between gap-3">
        <span class="text-xs font-medium text-ink-muted">Username</span>
        <span class="font-mono text-sm font-medium text-ink">{{ driver.app_username }}</span>
      </div>
    </div>
  </BaseCard>
</template>
