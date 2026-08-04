<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import AppShell from "@/layouts/AppShell.vue";
import AuthLayout from "@/layouts/AuthLayout.vue";
import ToastContainer from "@/components/ToastContainer.vue";
import UpdateBanner from "@/components/UpdateBanner.vue";

const route = useRoute();
const isAuthLayout = computed(() => route.meta.layout === "auth");
</script>

<template>
  <!-- New-deploy banner: above every layout so it's visible on any page, not just the dashboard. -->
  <UpdateBanner />
  <AuthLayout v-if="isAuthLayout">
    <RouterView />
  </AuthLayout>
  <AppShell v-else>
    <RouterView />
  </AppShell>
  <ToastContainer />
</template>
