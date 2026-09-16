<script setup lang="ts">
/**
 * How current the telematics behind this tab is, before its numbers are believed (SAM-S5).
 *
 * The three tiers its neighbours are built from: the coverage tile is telematics, idle waste is
 * idle, and the theft figures read the live stats feed. IFTA and the roster tiers annotate their own
 * pages instead — naming them here would report a breach nobody can act on from here.
 */
import SamsaraFeedLine from "@/components/SamsaraFeedLine.vue";
</script>

<template>
  <SamsaraFeedLine :feeds="['stats', 'telematics', 'idle']" />
</template>
