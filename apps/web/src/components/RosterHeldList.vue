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
 * D-RL5/D-RL6 (2026-11-06): the first version told the office to "finish the hire in Hiring", which nobody
 * does — the carrier hires in McLeod — and to "unarchive" a rehire whose row was terminated, not archived.
 * Both cases are now settled by the sweep; what remains here are the ones a person really has to decide.
 *
 * Each reason ends in the step that settles it, because every one of them is settled on OUR side, and the
 * next sweep (within 15 minutes) links or creates the driver by itself. Nothing here is a button: the
 * sweep owns the outcome, and a second way to link a driver by hand is the workaround this replaces.
 */
const { data } = useRosterHeld();
const session = useSessionStore();
const drivers = computed(() => data.value?.drivers ?? []);

const REMEDY: Record<RosterHeldReason, string> = {
  // D-RL5 (2026-11-06): McLeod's hire is the hire, so an application matching on licence AND name is
  // hired by the sweep itself. What is left here is an application that matches on one but not the other.
  applicant:
    "matches an application in Hiring, but not on both the licence number and the name. Correct the application and they are added here within 15 minutes.",
  fuel_card:
    "matches a fuel-card driver here by name only. They are linked by themselves once they log into the ELD and Samsara adds their licence.",
  ambiguous: "matches more than one driver here. Archive the duplicate and they are linked within 15 minutes.",
  rehire_review:
    "worked here before, and McLeod's record does not prove they came back — usually because their old record was ended here rather than in McLeod. If they are back, open that record (it may be under Show archived) and set it to Active.",
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
