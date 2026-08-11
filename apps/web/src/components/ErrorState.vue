<script setup lang="ts">
import { AppIcon } from "@fuelguard/ui";
import {
  ArrowPathIcon,
  ExclamationTriangleIcon,
} from "@fuelguard/ui/icons";
import { AppButton as BaseButton } from "@fuelguard/ui";

withDefaults(defineProps<{ message?: string; retrying?: boolean }>(), {
  message: "Something went wrong while loading this data.",
});
const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="flex flex-col items-center gap-3 px-6 py-12 text-center">
    <AppIcon :icon="ExclamationTriangleIcon" class="size-8 text-warning-500" aria-hidden="true" />
    <p class="max-w-md text-sm text-ink-secondary">{{ message }}</p>
    <BaseButton :disabled="retrying" @click="emit('retry')">
      <AppIcon :icon="ArrowPathIcon" class="size-4" :class="{ 'animate-spin': retrying }" aria-hidden="true" />
      {{ retrying ? "Retrying…" : "Retry" }}
    </BaseButton>
  </div>
</template>
