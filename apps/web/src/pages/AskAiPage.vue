<script setup lang="ts">
import { onMounted, ref } from "vue";
import { AppIconButton } from "@silvicom/ui";
import { PencilSquareIcon } from "@silvicom/ui/icons";
import PageHeader from "@/components/ui/PageHeader.vue";
import AssistantThread from "@/components/assistant/AssistantThread.vue";
import { suggestionsFor } from "@/components/assistant/suggestions";
import { useAssistantStore } from "@/stores/assistant";

/**
 * Ask AI at full width — the same thread the floating dock shows (F21, D-AI9), so "Open full page"
 * from the dock lands here with the conversation intact. The title comes from `route.meta.title`
 * via `PageHeader`; the hand-built `<h1>` row the old page drew above it was a second title (W4).
 */
const store = useAssistantStore();
const thread = ref<InstanceType<typeof AssistantThread> | null>(null);
const suggestions = suggestionsFor("/ask", 6);

onMounted(() => thread.value?.focus());
</script>

<template>
  <div class="space-y-6">
    <PageHeader>
      Plain-language answers from your own fleet data.
      <template v-if="store.turns.length" #actions>
        <AppIconButton :icon="PencilSquareIcon" label="New chat" variant="secondary" @click="store.clear()" />
      </template>
    </PageHeader>
    <div class="flex h-[calc(100dvh-14rem)] min-h-[28rem] flex-col overflow-hidden rounded-surface bg-surface shadow-card ring-1 ring-edge-subtle">
      <AssistantThread ref="thread" :suggestions="suggestions" size="page" />
    </div>
  </div>
</template>
