<script setup lang="ts">
import type { ProgramPerson } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";

/**
 * A person on a Drug & Alcohol tab: linked to the driver page when we hold the driver, in the one
 * link shape every list uses (`AppButton variant="link" :to`, contract §5.1 #2). A name with no link
 * is someone Med-Stop lists that no driver here matches.
 */
defineProps<{ person: ProgramPerson }>();
</script>

<template>
  <BaseButton v-if="person.driverId" variant="link" :to="{ name: 'driver-detail', params: { id: person.driverId } }" class="font-medium" @click.stop>
    {{ person.name }}
  </BaseButton>
  <span v-else>{{ person.name }}</span>
</template>
