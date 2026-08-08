<script setup lang="ts">
import { AppIcon } from "@fuelguard/ui";
import { NoSymbolIcon, ShieldCheckIcon } from "@fuelguard/ui/icons";
import type { DriverAppAccess } from "@fuelguard/shared";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseCard from "@/components/ui/BaseCard.vue";

defineProps<{
  access: Exclude<DriverAppAccess, "none">;
  busy: boolean;
  enabling: boolean;
}>();

const emit = defineEmits<{
  disable: [];
  enable: [];
}>();
</script>

<template>
  <section aria-labelledby="access-control-heading">
    <h3 id="access-control-heading" class="text-sm font-semibold text-ink">Account access</h3>
    <BaseCard padding="none" class="mt-3">
      <div class="flex items-center gap-3 p-4">
        <div
          class="flex size-9 shrink-0 items-center justify-center rounded-lg"
          :class="
            access === 'active'
              ? 'bg-success-50 text-success-700'
              : 'bg-warning-50 text-warning-700'
          "
        >
          <AppIcon
            :icon="access === 'active' ? ShieldCheckIcon : NoSymbolIcon"
            class="size-5"
            aria-hidden="true"
          />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-ink">
            {{ access === "active" ? "Access is enabled" : "Access is disabled" }}
          </p>
          <p class="mt-0.5 text-xs leading-5 text-ink-muted">
            {{
              access === "active"
                ? "Disable to sign the driver out temporarily."
                : "Enable when the driver should be able to sign in again."
            }}
          </p>
        </div>
        <BaseButton v-if="access === 'active'" size="sm" :disabled="busy" @click="emit('disable')">
          Disable
        </BaseButton>
        <BaseButton v-else variant="primary" size="sm" :disabled="busy" @click="emit('enable')">
          {{ enabling ? "Enabling…" : "Enable" }}
        </BaseButton>
      </div>
    </BaseCard>
  </section>
</template>
