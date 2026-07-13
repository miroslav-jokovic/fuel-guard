<script setup lang="ts">
import { computed } from "vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";

const props = defineProps<{ status: string }>();

const cls = computed(() => {
  switch (props.status) {
    case "active":
    case "resolved":
      return toneClass("success");
    case "maintenance":
    case "investigating":
      return toneClass("warning");
    case "open":
      return toneClass("brand");
    default: // retired / inactive / dismissed / superseded
      return toneClass("neutral");
  }
});
</script>

<template>
  <span :class="[BADGE_BASE, cls]">{{ status }}</span>
</template>
