<script setup lang="ts">
import { AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import type { Icon } from "@silvicom/ui/icons";

/**
 * A `KebabMenu` item that says what it does before you choose it: an icon, the label, and one line
 * under it (office chat's New menu, D-CHATUI23, 2026-11-01). The plain `kebab-item` is right for a
 * table row's Edit / Remove; a menu that STARTS something — a conversation, a team, a channel —
 * reads better when each choice explains itself, as Slack's and Linear's create menus do.
 *
 * It is the same `kebab-item` button underneath, so hover, disabled and keyboard behaviour stay the
 * menu's own. Put it in a `KebabMenu width="wide"`.
 */
defineProps<{ icon: Icon; label: string; description?: string }>();
defineEmits<{ click: [] }>();
</script>

<template>
  <BaseButton size="row" class="kebab-item py-2.5" @click="$emit('click')">
    <span class="flex w-full items-start gap-3">
      <AppIcon :icon="icon" class="mt-0.5 size-4 shrink-0 text-ink-tertiary" aria-hidden="true" />
      <span class="min-w-0 flex-1">
        <span class="block font-medium text-ink" data-kebab-label>{{ label }}</span>
        <span v-if="description" class="block text-xs font-normal text-ink-muted">{{ description }}</span>
      </span>
    </span>
  </BaseButton>
</template>
