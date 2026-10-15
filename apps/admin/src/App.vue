<script setup lang="ts">
import { RouterView } from "vue-router";
import { ConfirmHost } from "@silvicom/ui";
</script>

<template>
  <RouterView />
  <!-- D-US7: the one "are you sure?", in place of window.confirm, as in the web app. -->
  <ConfirmHost />
</template>
