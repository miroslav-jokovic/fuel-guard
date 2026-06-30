<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import AppShell from "@/layouts/AppShell.vue";
import AuthLayout from "@/layouts/AuthLayout.vue";
import ToastContainer from "@/components/ToastContainer.vue";

const route = useRoute();
const isAuthLayout = computed(() => route.meta.layout === "auth");
</script>

<template>
  <AuthLayout v-if="isAuthLayout">
    <RouterView />
  </AuthLayout>
  <AppShell v-else>
    <RouterView />
  </AppShell>
  <ToastContainer />
</template>
