<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import AppShell from "@/layouts/AppShell.vue";
import AuthLayout from "@/layouts/AuthLayout.vue";
import PublicLayout from "@/layouts/PublicLayout.vue";
import ToastContainer from "@/components/ToastContainer.vue";
import UpdateBanner from "@/components/UpdateBanner.vue";

const route = useRoute();
const isAuthLayout = computed(() => route.meta.layout === "auth");
const isPublicLayout = computed(() => route.meta.layout === "public");
const isLabLayout = computed(() => route.meta.layout === "lab");
</script>

<template>
  <!-- New-deploy banner: above every layout so it's visible on any page, not just the dashboard. -->
  <UpdateBanner />
  <RouterView v-if="isLabLayout" />
  <AuthLayout v-else-if="isAuthLayout">
    <RouterView />
  </AuthLayout>
  <PublicLayout v-else-if="isPublicLayout">
    <RouterView />
  </PublicLayout>
  <AppShell v-else>
    <RouterView />
  </AppShell>
  <ToastContainer />
</template>
