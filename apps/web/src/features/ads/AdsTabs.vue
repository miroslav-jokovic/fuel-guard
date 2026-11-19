<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AppTabs } from "@silvicom/ui";
import { useAdsTabs } from "./useAdsTabs";

/**
 * The Ads workspace's tab strip (ADS-PLATFORM-V2-PLAN V6; Q-APX18 (a)): one sidebar entry, its screens as tabs, the
 * way `RecruitmentTabs` holds Recruitment's (D-HUI8). Each tab is a real route with its own `PageHeader`, so a link
 * can land on any of them — RecruitmentTabs' header says why tabs navigate rather than swap a panel.
 *
 * WHICH tabs, and in what order, is the surface catalogue's; WHICH of them this person sees is `useAdsTabs`'.
 */
const route = useRoute();
const router = useRouter();
const visible = useAdsTabs().tabs;
const tabs = computed(() => visible.value.map((t) => ({ value: t.path, label: t.label })));

const current = computed({
  get: () => tabs.value.find((t) => t.value === route.path)?.value ?? "/ads",
  set: (path: string) => {
    if (path !== route.path) void router.push(path);
  },
});
</script>

<template>
  <AppTabs v-model="current" :tabs="tabs" label="Ads views" />
</template>
