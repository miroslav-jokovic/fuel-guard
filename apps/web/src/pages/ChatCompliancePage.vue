<script setup lang="ts">
import { computed, ref } from "vue";
import type { ChatComplianceReason } from "@silvicom/shared";
import { AppTabs, type TabItem } from "@silvicom/ui";
import { useQueryState } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import StepUpPrompt from "@/components/StepUpPrompt.vue";
import { useStepUpRetry } from "@/composables/useStepUpRetry";
import { useToastStore } from "@/stores/toast";
import ReasonCard from "@/features/chat/compliance/ReasonCard.vue";
import ConversationsTab from "@/features/chat/compliance/ConversationsTab.vue";
import MessagesTab from "@/features/chat/compliance/MessagesTab.vue";
import AccessLogTab from "@/features/chat/compliance/AccessLogTab.vue";
import HoldsTab from "@/features/chat/compliance/HoldsTab.vue";
import ExportsTab from "@/features/chat/compliance/ExportsTab.vue";
import ThreadModal from "@/features/chat/compliance/ThreadModal.vue";
import { reasonComplete, useCompliancePeopleQuery, type RunAct } from "@/features/chat/compliance/useChatCompliance";

/**
 * Settings → Chat compliance (OFFICE-CHAT-PLAN CHA2, D-CHAT14): the one place another person's office
 * chat can be read. Behind the `chat.compliance` grant on the Permissions page (admins by default), a
 * password confirmation, and a reason that is written into the chat record with every act. No notice
 * is shown to the people whose messages are read (Q-CHAT12: the employment contract covers it); every
 * holder of the permission sees every act in the Access log (Q-CHAT11).
 *
 * Holds and exports (CHA3, D-CHAT15, D-CHAT20) take the same reason and the same password prompt.
 *
 * The reason is typed once and travels with every search and every opened conversation. A
 * `step_up_required` refusal becomes the password prompt, and the same act runs again on confirmation.
 */
const toast = useToastStore();
const qs = useQueryState();

const TABS: TabItem[] = [
  { value: "conversations", label: "Conversations" },
  { value: "messages", label: "Messages" },
  { value: "holds", label: "Holds" },
  { value: "exports", label: "Exports" },
  { value: "access", label: "Access log" },
];
const tab = qs.param("tab", TABS.map((t) => t.value), "conversations");

const category = ref<string | null>(null);
const text = ref("");
const reason = computed<ChatComplianceReason | null>(() => {
  const r = { category: category.value, text: text.value };
  return reasonComplete(r) ? { category: r.category, text: r.text.trim() } : null;
});

const people = useCompliancePeopleQuery();
const peopleList = computed(() => people.data.value ?? []);

const { stepUpFor, holdForStepUp, confirmed, cancel } = useStepUpRetry();
const run: RunAct = async (task) => {
  try {
    await task();
  } catch (e) {
    if (holdForStepUp(e, task)) return;
    toast.error(e instanceof Error ? e.message : "Could not complete that.");
  }
};

const openId = ref<string | null>(null);

/** "Place a hold" in a conversation's window hands the conversation to the Holds tab, which takes the matter. */
const holdConversation = ref<{ id: string; title: string } | null>(null);
function holdFromThread(c: { id: string; title: string }) {
  holdConversation.value = c;
  openId.value = null;
  tab.value = "holds";
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Read, hold and export office chat for an HR, legal or safety matter. Everything you do here is recorded with your reason." />

    <ReasonCard v-model:category="category" v-model:text="text" />

    <AppTabs v-model="tab" :tabs="TABS" label="Compliance view" id-prefix="chat-compliance" />

    <div v-if="tab === 'conversations'" id="chat-compliance-panel-conversations" role="tabpanel" aria-labelledby="chat-compliance-tab-conversations">
      <ConversationsTab :reason="reason" :people="peopleList" :run="run" @open="openId = $event" />
    </div>
    <div v-else-if="tab === 'messages'" id="chat-compliance-panel-messages" role="tabpanel" aria-labelledby="chat-compliance-tab-messages">
      <MessagesTab :reason="reason" :people="peopleList" :run="run" @open="openId = $event" />
    </div>
    <div v-else-if="tab === 'holds'" id="chat-compliance-panel-holds" role="tabpanel" aria-labelledby="chat-compliance-tab-holds">
      <HoldsTab :reason="reason" :people="peopleList" :run="run" :conversation="holdConversation" @clear-conversation="holdConversation = null" />
    </div>
    <div v-else-if="tab === 'exports'" id="chat-compliance-panel-exports" role="tabpanel" aria-labelledby="chat-compliance-tab-exports">
      <ExportsTab :run="run" />
    </div>
    <div v-else id="chat-compliance-panel-access" role="tabpanel" aria-labelledby="chat-compliance-tab-access">
      <AccessLogTab />
    </div>

    <ThreadModal :thread-id="openId" :reason="reason" :run="run" @close="openId = null" @hold="holdFromThread" />
    <StepUpPrompt v-if="stepUpFor" :reason="stepUpFor" @confirmed="confirmed" @cancel="cancel" />
  </div>
</template>
