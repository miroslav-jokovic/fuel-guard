<script setup lang="ts">
import { computed } from "vue";
import { AppTabs, useQueryState } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import { useSessionStore } from "@/stores/session";
import TrainingVideos from "@/features/training/TrainingVideos.vue";
import TrainingSend from "@/features/training/TrainingSend.vue";
import TrainingProgress from "@/features/training/TrainingProgress.vue";

/**
 * Safety › Training (SAFETY-VIDEOS-AND-QUIZZES-ANALYSIS §8–§9): the drivers' safety films with a quiz
 * after each, sent as a link that opens on a phone with no app and no login (D-TR2). Three tabs, the
 * mockup's: Videos (add and publish films, D-TR5), Send to drivers (D-TR3, D-TR11) and Progress. The tab
 * is in the URL (`?view=`), so each can be linked to.
 *
 * The whole page answers to `safety` (the surface's gate): `view` reads every tab, `manage` uploads,
 * publishes and sends — the same split the API enforces.
 */
const qs = useQueryState();
const view = qs.param("view", ["send", "progress"] as const);
const session = useSessionStore();
const canManage = computed(() => session.can("safety"));
const tabs = [
  { value: "videos", label: "Videos" },
  { value: "send", label: "Send to drivers" },
  { value: "progress", label: "Progress" },
];
/** Switching tab clears the other tab's search, filter, page and open film, which share the URL's names. */
function setView(v: string) {
  qs.set({ view: v === "send" || v === "progress" ? v : undefined, film: undefined, search: undefined, status: undefined, page: undefined });
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Safety videos with a short quiz after each one. Drivers watch on their phone from a link: no app or login needed." />
    <AppTabs :model-value="view || 'videos'" :tabs="tabs" label="Training view" @update:model-value="setView" />
    <TrainingSend v-if="view === 'send'" :can-manage="canManage" />
    <TrainingProgress v-else-if="view === 'progress'" :can-manage="canManage" />
    <TrainingVideos v-else :can-manage="canManage" />
  </div>
</template>
