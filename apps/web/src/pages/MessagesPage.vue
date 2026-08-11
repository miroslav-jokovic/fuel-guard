<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  messageBody,
  messagePreview,
  seenByOthers,
  sortThreads,
  threadTitle,
  type Thread,
} from "@fuelguard/shared";
import { useSessionStore } from "@/stores/session";
import { useModulesQuery } from "@/composables/useModules";
import { useDriversQuery } from "@/composables/useDrivers";
import {
  useComposeThreads,
  useMarkThreadRead,
  useSendMessage,
  useThreadDetailQuery,
  useThreadsQuery,
} from "@/features/messages/useMessages";
import { useToastStore } from "@/stores/toast";
import { AppButton as BaseButton } from "@fuelguard/ui";
import { AppCard as BaseCard } from "@fuelguard/ui";
import { AppCheckbox as BaseCheckbox } from "@fuelguard/ui";
import { AppInput as BaseInput } from "@fuelguard/ui";
import { AppFormField as FormField } from "@fuelguard/ui";
import PageHeader from "@/components/ui/PageHeader.vue";

/**
 * The dispatch inbox (hardening plan Phase 7, D-PM4 — Samsara's model): thread list + open
 * conversation side by side, compose to one or many drivers (one private thread per driver, never
 * an accidental group chat), read receipts via participant last_read_at, and NO delete — sent
 * correspondence is a record (D54: never hard-deleted). The dashboard shows the last 90 days
 * (Samsara's window); older history stays queryable by audit.
 */

const session = useSessionStore();
const toast = useToastStore();
const route = useRoute();
const router = useRouter();

const modules = useModulesQuery();
const messagesEntitled = computed(() => modules.data.value?.has("messages") ?? false);

const threadsQ = useThreadsQuery(messagesEntitled);
const selectedId = ref<string | null>(
  typeof route.query.thread === "string" ? route.query.thread : null,
);
const detailQ = useThreadDetailQuery(selectedId);
const sendMsg = useSendMessage();
const markRead = useMarkThreadRead();
const compose = useComposeThreads();

/** 90-day dashboard window (D-PM4). */
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const visibleThreads = computed<Thread[]>(() => {
  const cutoff = Date.now() - NINETY_DAYS_MS;
  return sortThreads(
    (threadsQ.data.value?.threads ?? []).filter((t) => Date.parse(t.last_message_at) >= cutoff),
  );
});

const scroller = ref<HTMLElement | null>(null);
function openThread(id: string) {
  selectedId.value = id;
  void router.replace({ query: { ...route.query, thread: id } });
  markRead.mutate(id);
}
watch(
  () => detailQ.data.value?.messages.length,
  async () => {
    await nextTick();
    scroller.value?.scrollTo({ top: scroller.value.scrollHeight });
  },
);
// A conversation open on screen is a conversation being read.
watch(
  () => detailQ.data.value?.thread.id,
  (id) => {
    if (id) markRead.mutate(id);
  },
);

const draft = ref("");
async function send() {
  const id = selectedId.value;
  const body = draft.value.trim();
  if (!id || !body) return;
  try {
    await sendMsg.mutateAsync({ threadId: id, body });
    draft.value = "";
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Could not send the message");
  }
}

// ── compose to one or many drivers ────────────────────────────────────────────
const composing = ref(false);
const driversQ = useDriversQuery();
const appDrivers = computed(() =>
  (driversQ.data.value ?? []).filter((d) => d.app_access_enabled || d.user_id),
);
const picked = ref<Set<string>>(new Set());
const composeSubject = ref("");
const composeBody = ref("");
function togglePick(id: string, on: boolean) {
  const next = new Set(picked.value);
  if (on) next.add(id);
  else next.delete(id);
  picked.value = next;
}
async function sendCompose() {
  const body = composeBody.value.trim();
  if (picked.value.size === 0 || !body) return;
  try {
    const result = await compose.mutateAsync({
      driverIds: [...picked.value],
      body,
      subject: composeSubject.value.trim() || undefined,
    });
    if (result.failed.length > 0) {
      toast.error(`Sent to ${result.sent}; ${result.failed.length} driver(s) have no app account yet`);
    } else {
      toast.success(result.sent === 1 ? "Message sent" : `Sent to ${result.sent} drivers`);
    }
    composing.value = false;
    picked.value = new Set();
    composeSubject.value = "";
    composeBody.value = "";
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Could not send");
  }
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date().toDateString() === d.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
</script>

<template>
  <div class="space-y-4">
    <PageHeader description="Driver conversations — the last 90 days. Messages can't be deleted; they're part of the record.">
      <template #actions>
        <BaseButton @click="composing = !composing">{{ composing ? "Cancel" : "New message" }}</BaseButton>
      </template>
    </PageHeader>

    <BaseCard v-if="!messagesEntitled">
      <p class="text-sm text-ink-muted">Messages isn't part of your plan. Contact FuelGuard to enable it.</p>
    </BaseCard>

    <BaseCard v-else-if="composing">
      <h2 class="text-sm font-semibold text-ink-secondary">New message</h2>
      <p class="mt-1 text-sm text-ink-muted">
        Pick one driver for a conversation, or several for an announcement — each driver gets their own
        private thread with dispatch.
      </p>
      <div class="mt-3 grid max-h-56 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
        <label
          v-for="d in appDrivers"
          :key="d.id"
          class="flex items-center gap-2 rounded-control px-2 py-1.5 text-sm text-ink hover:bg-surface-subtle"
        >
          <BaseCheckbox :model-value="picked.has(d.id)" @update:model-value="(v: boolean) => togglePick(d.id, v)" />
          {{ d.full_name }}
        </label>
        <p v-if="appDrivers.length === 0" class="px-2 py-1.5 text-sm text-ink-muted">
          No drivers with app accounts yet.
        </p>
      </div>
      <div class="mt-3 flex flex-wrap items-end gap-2">
        <FormField label="Subject (optional)">
          <BaseInput v-model="composeSubject" placeholder="e.g. Yard closed Friday" />
        </FormField>
        <FormField label="Message" class="flex-1">
          <BaseInput v-model="composeBody" placeholder="Type your message…" @keydown.enter.prevent="sendCompose" />
        </FormField>
        <BaseButton :disabled="picked.size === 0 || !composeBody.trim() || compose.isPending.value" @click="sendCompose">
          Send{{ picked.size > 1 ? ` to ${picked.size}` : "" }}
        </BaseButton>
      </div>
    </BaseCard>

    <div v-if="messagesEntitled" class="grid gap-4 lg:grid-cols-[320px,1fr]">
      <!-- Thread list -->
      <BaseCard padding="none" class="max-h-[70vh] overflow-y-auto">
        <ul class="divide-y divide-edge-subtle">
          <li v-for="t in visibleThreads" :key="t.id">
            <BaseButton
              type="button"
              class="w-full px-4 py-3 text-left hover:bg-surface-subtle"
              :class="selectedId === t.id ? 'bg-surface-subtle' : ''"
              @click="openThread(t.id)"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="truncate text-sm font-medium text-ink">{{ threadTitle(t, session.userId ?? "") }}</span>
                <span class="shrink-0 text-xs tabular-nums text-ink-muted">{{ timeLabel(t.last_message_at) }}</span>
              </div>
              <div class="mt-0.5 flex items-center justify-between gap-2">
                <span class="truncate text-sm text-ink-muted">{{ messagePreview(t.last_message) }}</span>
                <span
                  v-if="t.unread > 0"
                  class="shrink-0 rounded-full bg-brand-accent-strong px-1.5 py-0.5 text-xs font-semibold text-ink"
                >{{ t.unread }}</span>
              </div>
            </BaseButton>
          </li>
          <li v-if="visibleThreads.length === 0" class="px-4 py-8 text-center text-sm text-ink-muted">
            {{ threadsQ.isLoading.value ? "Loading…" : "No conversations in the last 90 days." }}
          </li>
        </ul>
      </BaseCard>

      <!-- Open conversation -->
      <BaseCard v-if="selectedId && detailQ.data.value" padding="none" class="flex max-h-[70vh] flex-col">
        <div class="border-b border-edge-subtle px-4 py-3">
          <div class="text-sm font-semibold text-ink">
            {{ threadTitle(detailQ.data.value.thread, session.userId ?? "") }}
          </div>
          <div v-if="detailQ.data.value.thread.load_ref" class="text-xs text-ink-muted">
            About load {{ detailQ.data.value.thread.load_ref }}
          </div>
        </div>
        <div ref="scroller" class="flex-1 space-y-2 overflow-y-auto px-4 py-3">
          <div
            v-for="m in detailQ.data.value.messages"
            :key="m.id"
            class="max-w-[75%] rounded-surface px-3 py-2 text-sm"
            :class="m.sender_user_id === session.userId
              ? 'ml-auto bg-action-primary text-action-primary-foreground'
              : 'bg-surface-subtle text-ink'"
          >
            <div v-if="m.sender_user_id !== session.userId" class="text-xs font-semibold opacity-80">
              {{ m.sender_name ?? "Driver" }}
            </div>
            <div :class="m.deleted_at ? 'italic opacity-70' : ''">{{ messageBody(m) }}</div>
            <div class="mt-0.5 text-right text-[11px] opacity-70">
              {{ timeLabel(m.created_at) }}
              <template v-if="m.sender_user_id === session.userId">
                · {{ seenByOthers(detailQ.data.value.thread, m.created_at, session.userId ?? "") ? "Seen" : "Sent" }}
              </template>
            </div>
          </div>
          <p v-if="detailQ.data.value.messages.length === 0" class="py-6 text-center text-sm text-ink-muted">
            No messages yet.
          </p>
        </div>
        <form class="flex items-center gap-2 border-t border-edge-subtle px-4 py-3" @submit.prevent="send">
          <BaseInput v-model="draft" class="flex-1" placeholder="Type a message…" />
          <BaseButton type="submit" :disabled="!draft.trim() || sendMsg.isPending.value">Send</BaseButton>
        </form>
      </BaseCard>
      <BaseCard v-else class="flex min-h-[40vh] items-center justify-center">
        <p class="text-sm text-ink-muted">Pick a conversation, or start a new message.</p>
      </BaseCard>
    </div>
  </div>
</template>
