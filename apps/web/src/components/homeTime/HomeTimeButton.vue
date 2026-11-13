<script setup lang="ts">
import { computed } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { useModulesQuery } from "@/composables/useModules";
import { useSessionStore } from "@/stores/session";
import HomeTimeDrawer from "./HomeTimeDrawer.vue";
import { useHomeTimeDrawer } from "./useHomeTimeDrawer";

/**
 * The driver page's "Home time" button (HOME-TIME-PLAN D-HT8, the third entry point): opens the same
 * drawer the Dispatch board opens, on this driver — for one who has no truck row to open it from.
 *
 * It owns the page's one `HomeTimeDrawer`, so a detail page adds a single tag. Renders nothing for
 * somebody who cannot view Dispatch, or on a carrier without the module: `/api/roster/home-time` would
 * answer them 403, and a button that opens a refusal is not an entry point. (A recruiter and a safety
 * manager open the driver page for the qualification file and have no Dispatch.)
 */
defineProps<{ driverId: string }>();
const session = useSessionStore();
const modules = useModulesQuery();
const { zone } = useOrgTimezone();
const drawer = useHomeTimeDrawer();
const on = computed(() => session.canView("dispatch") && (modules.data.value?.has("dispatch") ?? false));
</script>

<template>
  <template v-if="on">
    <BaseButton data-home-time-button @click="drawer.open(driverId)">Home time</BaseButton>
    <HomeTimeDrawer :zone="zone" />
  </template>
</template>
