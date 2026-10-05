<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { AppIcon, AppButton as BaseButton } from "@silvicom/ui";
import { BellIcon } from "@silvicom/ui/icons";
import SlideOver from "@/components/SlideOver.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { notificationRoute } from "@/lib/notificationRoute";
import { useOpens } from "@/composables/useOpens";
import { useToastStore } from "@/stores/toast";
import {
  useDismissNotifications,
  useMarkNotificationsRead,
  useNotificationsQuery,
  type OfficeNotification,
} from "@/composables/useNotifications";

/**
 * The office bell (DQF plan C6) — the web half of the notification system the driver app already
 * had. By the time this shipped, C3's alert scheduler had been writing ledger rows for a while, so
 * the inbox opens with history in it rather than empty. Scope per the plan: list, unread count,
 * mark read, deep link — preferences stay driver-app-only until someone asks. "Clear all" joined it
 * on 2026-10-05 (0430), once the card status poll could fill an inbox in an afternoon.
 */
const open = ref(false);
const router = useRouter();
const { notifications, unread } = useNotificationsQuery();
const markRead = useMarkNotificationsRead();
const dismiss = useDismissNotifications();
const opens = useOpens();
const toast = useToastStore();
// Clearing cannot be undone from here, so it asks first — in place of the list, not in a second
// dialog stacked on the drawer (DESIGN-SYSTEM-CONTRACT §6.2).
const confirmingClear = ref(false);

function close(): void {
  open.value = false;
  confirmingClear.value = false;
}

function markAllRead(): void {
  markRead.mutate(undefined, {
    onError: (e) => toast.error("Could not mark all read", e instanceof Error ? e.message : undefined),
  });
}

function clearAll(): void {
  dismiss.mutate(undefined, {
    onSuccess: () => (confirmingClear.value = false),
    onError: (e) => toast.error("Could not clear notifications", e instanceof Error ? e.message : undefined),
  });
}

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

// Reading is always recorded; going somewhere only when the destination opens for this reader (SP5).
function openItem(n: OfficeNotification): void {
  if (n.read_at === null) markRead.mutate([n.id]);
  const to = notificationRoute(n.category, n.entity_type, n.entity_id, opens);
  if (to) {
    close();
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

    <SlideOver :open="open" title="Notifications" @close="close">
      <div v-if="confirmingClear" class="flex min-h-[20rem] flex-col items-center justify-center text-center">
        <h3 class="text-sm font-semibold text-ink">Clear all notifications?</h3>
        <p class="mt-2 max-w-sm text-sm text-ink-muted">
          They leave your list and count as read. This cannot be undone. Nobody else's notifications
          change, and new ones still arrive here.
        </p>
      </div>
      <div v-else-if="notifications.length === 0" class="py-10 text-center text-sm text-ink-muted">
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
        <div v-if="confirmingClear" class="flex items-center justify-end gap-3">
          <BaseButton :disabled="dismiss.isPending.value" @click="confirmingClear = false">Back</BaseButton>
          <BaseButton variant="danger" :disabled="dismiss.isPending.value" @click="clearAll">
            {{ dismiss.isPending.value ? "Clearing…" : "Clear all" }}
          </BaseButton>
        </div>
        <div v-else class="flex items-center justify-end gap-3">
          <BaseButton
            variant="ghost"
            size="sm"
            :disabled="notifications.length === 0"
            @click="confirmingClear = true"
          >
            Clear all…
          </BaseButton>
          <BaseButton
            variant="ghost"
            size="sm"
            :disabled="unread === 0 || markRead.isPending.value"
            @click="markAllRead"
          >
            Mark all read
          </BaseButton>
        </div>
      </template>
    </SlideOver>
  </div>
</template>
