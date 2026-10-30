<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { AppCallout } from "@silvicom/ui";
import type { RosterHeldReason } from "@silvicom/shared";
import { useRosterHeld } from "@/composables/useRosterHeld";
import { useSessionStore } from "@/stores/session";
import { formatDate } from "@/lib/format";

/**
 * McLeod drivers who are not on this list, and what settles each (ROSTER-LIFECYCLE-PLAN RL3).
 *
 * ── WHY IT IS ON THE DRIVERS PAGE ───────────────────────────────────────────────────────────────
 * This is where the question is asked. On 2026-10-30 the office went to give a new hire a tablet, could
 * not find him here, and read it as a broken sync. The sweep had held him on purpose, as an applicant
 * still open in Hiring, and nothing anywhere said so. A refusal shown where the person is missed answers
 * the question in the place it comes up; a log on the VM answers it for nobody.
 *
 * Each reason ends in the step that settles it, because every one of them is settled on OUR side, and the
 * next sweep (within 15 minutes) links or creates the driver by itself. Nothing here is a button: the
 * sweep owns the outcome, and a second way to link a driver by hand is the workaround this replaces.
 */
const { data } = useRosterHeld();
const session = useSessionStore();
const drivers = computed(() => data.value?.drivers ?? []);

const REMEDY: Record<RosterHeldReason, string> = {
  applicant: "is still an applicant in Hiring. Finish the hire there and they are added here within 15 minutes.",
  fuel_card:
    "matches a fuel-card driver here by name only. They are linked by themselves once they log into the ELD and Samsara adds their licence.",
  ambiguous: "matches more than one driver here. Archive the duplicate and they are linked within 15 minutes.",
  rehire_review:
    "worked here before, and McLeod's dates do not confirm the rehire. Show archived drivers, unarchive their old record and set it to Active.",
  not_created: "is not here because the McLeod connector is set to link drivers only, not to add them.",
};
</script>

<template>
  <!-- No icon: AppCallout wraps a block-level body below its icon, which left the icon alone on a line
       of its own (seen in the 2026-10-30 browser pass). The caution tone carries the signal. -->
  <AppCallout v-if="drivers.length" tone="caution" data-testid="roster-held">
    <p>
      {{ drivers.length === 1 ? "1 driver in McLeod is" : `${drivers.length} drivers in McLeod are` }} not on this
      list yet.
    </p>
    <ul class="mt-1 space-y-1 font-normal">
      <li v-for="d in drivers" :key="d.externalId" data-testid="roster-held-driver">
        <span class="font-medium">{{ d.name ?? d.externalId }}</span>
        ({{ d.externalId }}<template v-if="d.hireDate">, hired {{ formatDate(d.hireDate) }}</template>)
        {{ REMEDY[d.reason] }}
        <RouterLink
          v-if="d.reason === 'applicant' && session.canView('recruitment')"
          to="/recruitment"
          class="underline underline-offset-2"
        >Open Hiring</RouterLink>
      </li>
    </ul>
  </AppCallout>
</template>
