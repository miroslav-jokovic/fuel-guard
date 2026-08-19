<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { AppIcon, AppButton as BaseButton } from "@fuelguard/ui";
import { BellIcon } from "@fuelguard/ui/icons";
import SlideOver from "@/components/SlideOver.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { notificationRoute } from "@/lib/notificationRoute";
import {
  useMarkNotificationsRead,
  useNotificationsQuery,
  type OfficeNotification,
} from "@/composables/useNotifications";

/**
 * The office bell (DQF plan C6) — the web half of the notification system the driver app already
 * had. By the time this shipped, C3's alert scheduler had been writing ledger rows for a while, so
 * the inbox opens with history in it rather than empty. Scope per the plan: list, unread count,
 * mark read, deep link — preferences stay driver-app-only until someone asks.
 */
const open = ref(false);
const router = useRouter();
const { notifications, unread } = useNotificationsQuery();
const markRead = useMarkNotificationsRead();

const SEVERITY_TONE: Record<OfficeNotification["severity"], string> = {
  info: "info",
  warning: "warning",
  critical: "danger",
};

function agoLabel(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function openItem(n: OfficeNotification): void {
  if (n.read_at === null) markRead.mutate([n.id]);
  const to = notificationRoute(n.category, n.entity_type, n.entity_id);
  if (to) {
    open.value = false;
    void router.push(to);
  }
}
</script>

<template>
  <div>
    <button
      type="button"
      class="relative inline-flex size-9 items-center justify-center rounded-control text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      :aria-label="unread > 0 ? `Notifications — ${unread} unread` : 'Notifications'"
      @click="open = true"
    >
      <AppIcon :icon="BellIcon" class="size-5" aria-hidden="true" />
      <span
        v-if="unread > 0"
        class="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-danger-600 px-1 text-xs font-semibold text-ink-inverse"
        aria-hidden="true"
      >
        {{ unread > 99 ? "99+" : unread }}
      </span>
    </button>

    <SlideOver :open="open" title="Notifications" @close="open = false">
      <div v-if="notifications.length === 0" class="py-10 text-center text-sm text-ink-muted">
        Nothing yet. Qualification and fleet alerts land here as they happen.
      </div>
      <ul v-else class="space-y-1">
        <li v-for="n in notifications" :key="n.id">
          <button
            type="button"
            class="w-full rounded-control px-3 py-2.5 text-left transition-colors hover:bg-surface-subtle"
            :class="n.read_at === null ? 'bg-brand-50/40' : ''"
            @click="openItem(n)"
          >
            <span class="flex items-start gap-2">
              <span
                class="mt-1.5 size-2 shrink-0 rounded-full"
                :class="n.read_at === null ? 'bg-brand-600' : 'bg-transparent'"
                aria-hidden="true"
              />
              <span class="min-w-0">
                <span class="block text-sm font-medium text-ink">{{ n.title }}</span>
                <span v-if="n.body" class="mt-0.5 block truncate text-sm text-ink-muted">{{
                  n.body
                }}</span>
                <span class="mt-1 flex items-center gap-2">
                  <span :class="[BADGE_BASE, toneClass(SEVERITY_TONE[n.severity])]">{{
                    n.severity
                  }}</span>
                  <span class="text-xs text-ink-tertiary">{{ agoLabel(n.created_at) }}</span>
                </span>
              </span>
            </span>
          </button>
        </li>
      </ul>

      <template #footer>
        <div class="flex items-center justify-end">
          <BaseButton
            variant="ghost"
            size="sm"
            :disabled="unread === 0 || markRead.isPending.value"
            @click="markRead.mutate(undefined)"
          >
            Mark all read
          </BaseButton>
        </div>
      </template>
    </SlideOver>
  </div>
</template>
