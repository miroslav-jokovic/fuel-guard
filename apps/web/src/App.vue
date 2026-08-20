<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import AppShell from "@/layouts/AppShell.vue";
import AuthLayout from "@/layouts/AuthLayout.vue";
import PublicLayout from "@/layouts/PublicLayout.vue";
import ApplyLayout from "@/layouts/ApplyLayout.vue";
import ToastContainer from "@/components/ToastContainer.vue";
import UpdateBanner from "@/components/UpdateBanner.vue";
import EnvironmentBanner from "@/components/EnvironmentBanner.vue";

const route = useRoute();
/** The page knows the carrier's name only after the invitation resolves; the header shows it then. */
const applyCarrier = ref<string | null>(null);
const isAuthLayout = computed(() => route.meta.layout === "auth");
const isPublicLayout = computed(() => route.meta.layout === "public");
const isLabLayout = computed(() => route.meta.layout === "lab");
/**
 * The applicant's layout (H5b). Its own rather than `public`, because that one is a marketing
 * surface with a Sign in button — a dead end for somebody who has no account and is being asked for
 * their date of birth. The carrier's name comes from the page via a route-scoped ref.
 */
const isApplyLayout = computed(() => route.meta.layout === "apply");
</script>

<template>
  <!-- Which deployment this is. Above everything, including the sign-in page: the moment you most
       need to know you are not on production is before you type a password into it. -->
  <EnvironmentBanner />
  <!-- New-deploy banner: above every layout so it's visible on any page, not just the dashboard. -->
  <UpdateBanner />
  <RouterView v-if="isLabLayout" />
  <AuthLayout v-else-if="isAuthLayout">
    <RouterView />
  </AuthLayout>
  <PublicLayout v-else-if="isPublicLayout">
    <RouterView />
  </PublicLayout>
  <ApplyLayout v-else-if="isApplyLayout" :carrier="applyCarrier">
    <RouterView @carrier="applyCarrier = $event" />
  </ApplyLayout>
  <AppShell v-else>
    <RouterView />
  </AppShell>
  <ToastContainer />
</template>
