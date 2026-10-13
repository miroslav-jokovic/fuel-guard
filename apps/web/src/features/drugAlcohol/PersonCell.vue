<script setup lang="ts">
import type { ProgramPerson } from "@silvicom/shared";

/** A person on a Drug & Alcohol tab: linked to the driver page when we hold the driver. */
defineProps<{ person: ProgramPerson }>();
</script>

<template>
  <RouterLink v-if="person.driverId" :to="{ name: 'driver-detail', params: { id: person.driverId } }" class="text-brand-700 hover:underline">
    {{ person.name }}
  </RouterLink>
  <span v-else>{{ person.name }}</span>
</template>
