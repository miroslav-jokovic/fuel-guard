<script setup lang="ts">
import { formatDisplayDateTime, type MemberSession } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";

/**
 * The rows of a signed-in devices list (INSTALLED-APP-PLAN IA-S3): one place for what a device shows, so a
 * person's own list (the account menu) and an admin's list of a member's (the Users page) cannot differ.
 *
 * The device marked `current` is the one THIS request is signed in with, and never has a button — the API
 * refuses to end it from either list (409 `current_session`); that is Sign out.
 */
defineProps<{ devices: readonly MemberSession[]; busy: boolean }>();
const emit = defineEmits<{ end: [device: MemberSession] }>();
</script>

<template>
  <ul class="divide-y divide-edge-subtle" data-testid="signed-in-devices">
    <li v-for="d in devices" :key="d.id" class="flex items-start justify-between gap-3 py-3">
      <div class="min-w-0">
        <p class="text-sm font-semibold text-ink">
          {{ d.device }}
          <span v-if="d.current" class="ml-1 text-xs font-medium text-ink-muted">This device</span>
        </p>
        <p class="mt-0.5 text-xs text-ink-muted">Last used {{ formatDisplayDateTime(d.last_used_at) }}<template v-if="d.ip"> · {{ d.ip }}</template></p>
        <p class="mt-0.5 text-xs text-ink-tertiary">Signed in {{ formatDisplayDateTime(d.created_at) }}</p>
      </div>
      <BaseButton
        v-if="!d.current"
        size="sm"
        variant="secondary"
        :disabled="busy"
        :aria-label="`Sign out ${d.device}, last used ${formatDisplayDateTime(d.last_used_at)}`"
        @click="emit('end', d)"
      >
        Sign out
      </BaseButton>
    </li>
  </ul>
</template>
