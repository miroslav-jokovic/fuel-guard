<script setup lang="ts">
import { computed } from "vue";
import { BADGE_BASE } from "@/lib/badges";

const props = defineProps<{ status: string }>();

const SOFT: Record<string, string> = {
  red: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20",
  amber: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20",
  green: "bg-green-50 text-green-700 ring-1 ring-inset ring-green-600/20",
  indigo: "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-600/20",
  gray: "bg-gray-50 text-gray-600 ring-1 ring-inset ring-gray-500/20",
};

const cls = computed(() => {
  switch (props.status) {
    case "active":
    case "resolved":
      return SOFT.green;
    case "maintenance":
    case "investigating":
      return SOFT.amber;
    case "open":
      return SOFT.indigo;
    default: // retired / inactive / dismissed / superseded
      return SOFT.gray;
  }
});
</script>

<template>
  <span :class="[BADGE_BASE, cls]">{{ status }}</span>
</template>
