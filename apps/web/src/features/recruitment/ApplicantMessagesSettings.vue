<script setup lang="ts">
import { computed, ref } from "vue";
import {
  RECRUITING_MESSAGES,
  STANDARD_WORDING,
  formatDisplayDate,
  type MessageWording,
  type RecruitingMessageKey,
} from "@silvicom/shared";
import { AppBadge, AppButton as BaseButton, QueryState } from "@silvicom/ui";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useMessageWording, useSaveMessageWording } from "@/features/recruitment/useMessageWording";
import { useRecruitingSettings } from "@/features/recruitment/useRecruitingSettings";
import MessageWordingEditor from "@/features/recruitment/MessageWordingEditor.vue";

/**
 * Settings → Recruiting's "Messages" (HIRING-WORKFLOW-AUDIT §12 MT2, 0551).
 *
 * One row per catalogue message (`RECRUITING_MESSAGES`, never a list typed here): what it is, when it
 * goes, and whether it is in the standard words or the carrier's (with who saved them and when). "Edit
 * the wording" opens the editor with its preview; "Use the standard wording" saves four nulls — a new
 * row, like every save (D-MT5), so the history still says what went before.
 *
 * ⚠ A change applies to messages sent from now on, including a text already waiting overnight in the
 * outbox: it is worded when it goes (D-MT6). Said under the list.
 *
 * The preview's carrier name is the one the senders write (the GET answers it), and its days the carrier's own link lifetime
 * (`invite_ttl_days`), so `{carrier}` and `{days}` read as they will. Writes on `session.can("recruitment")`,
 * what the PUT asks — the same gate as every list on this page (D-MT10).
 */
const session = useSessionStore();
const toast = useToastStore();
const canManage = computed(() => session.can("recruitment"));
const messagesQ = useMessageWording();
const settingsQ = useRecruitingSettings();
const save = useSaveMessageWording();
const editing = ref<RecruitingMessageKey | null>(null);

const carrier = computed(() => messagesQ.data.value?.carrier ?? "Your company");
const days = computed(() => settingsQ.data.value?.settings.invite_ttl_days ?? 14);
const savedFor = (key: RecruitingMessageKey) => messagesQ.data.value?.messages.find((m) => m.key === key);
const isStandard = (w: MessageWording | undefined) =>
  !w || (w.emailSubject === null && w.emailHeading === null && w.emailParagraph === null && w.textLead === null);

async function write(key: RecruitingMessageKey, wording: MessageWording): Promise<void> {
  try {
    await save.mutateAsync({ key, wording });
    editing.value = null;
    toast.success(isStandard(wording) ? "Back to the standard wording" : "Wording saved");
  } catch (e) {
    toast.error("Could not save the wording", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-3" data-testid="applicant-messages">
    <QueryState
      :loading="messagesQ.isLoading.value"
      :error="messagesQ.isError.value ? messagesQ.error.value : null"
      error-text="Could not load the messages."
      :retrying="messagesQ.isFetching.value"
      loading-text="Loading the messages…"
      compact
      @retry="messagesQ.refetch()"
    >
      <p class="text-xs text-ink-secondary">
        A change applies to every message sent from now on, including a text waiting to go out in the morning.
      </p>
      <ul class="divide-y divide-edge">
        <li v-for="m in RECRUITING_MESSAGES" :key="m.key" class="space-y-3 py-3" :data-testid="`message-${m.key}`">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-medium text-ink">
                {{ m.label }}
                <AppBadge v-if="!isStandard(savedFor(m.key)?.wording)" tone="info" class="ml-2">Your wording</AppBadge>
              </p>
              <p class="text-xs text-ink-secondary">{{ m.sentWhen }}</p>
              <p v-if="savedFor(m.key)?.savedAt" class="text-xs text-ink-tertiary">
                Last changed {{ formatDisplayDate(savedFor(m.key)!.savedAt!) }} by {{ savedFor(m.key)!.savedByName }}
              </p>
            </div>
            <div v-if="canManage && editing !== m.key" class="flex shrink-0 gap-2">
              <BaseButton
                v-if="!isStandard(savedFor(m.key)?.wording)"
                size="sm"
                variant="ghost"
                :disabled="save.isPending.value"
                :data-testid="`message-standard-${m.key}`"
                @click="write(m.key, STANDARD_WORDING)"
              >
                Use the standard wording
              </BaseButton>
              <BaseButton size="sm" variant="secondary" :data-testid="`message-edit-${m.key}`" @click="editing = m.key">
                Edit the wording
              </BaseButton>
            </div>
          </div>
          <MessageWordingEditor
            v-if="editing === m.key"
            :message-key="m.key"
            :saved="savedFor(m.key)?.wording ?? STANDARD_WORDING"
            :carrier="carrier"
            :days="days"
            :saving="save.isPending.value"
            @save="(w) => write(m.key, w)"
            @cancel="editing = null"
          />
        </li>
      </ul>
    </QueryState>
  </div>
</template>
