<script setup lang="ts">
import { computed } from "vue";
import type { HiringChecklistRow, HiringStep, MedstopCloseStatus } from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import { hiringDrawerBody } from "@/features/recruitment/hiringStepDrawers";
import HiringStepBody from "@/features/recruitment/HiringStepBody.vue";

/**
 * One row of the hire, opened from the checklist (B6, `HIRING-UI-PLAN.md` §4.2).
 *
 * ── A ROW, NOT A STEP, SINCE §14 (D-OF2, owner 2026-11-03) ────────────────────────────────────
 * The owner read Part 1 and its permissions, the driving record and the medical card, and the
 * application and its approval as one act each — *"this is part of same invite form"*, *"this is
 * part of MVR step"*, *"just duplicate of previous section"*. So the checklist draws each pair as one
 * row (`hiringChecklistRows`, shared), and this drawer shows every step the row holds, each under its
 * own heading with its own state and its own panel (`HiringStepBody.vue`). The halves stay separate
 * facts because the product refuses on them separately; what merged is what the office reads.
 *
 * ── THE TITLE AND THE SUBTITLE ARE THE CATALOGUE'S, NOT THIS FILE'S ───────────────────────────
 * The heading is the row's label and the line under it is the `action` of the step the row is waiting
 * on — the instruction, which is what a drawer exists to carry out. Writing a third string per step
 * here would be a copy of `hiringSteps.ts` with a delay fuse.
 */
const props = defineProps<{
  open: boolean;
  row: HiringChecklistRow | null;
  driverId: string;
  driverStatus: string;
  /** The live invitation, resolved by the page. Null before one exists. */
  invitationId: string | null;
  /** The driver row's date of birth and licence (AF3), read by the page; null while it loads. */
  identity?: { date_of_birth?: string | null; cdl_number?: string | null; cdl_state?: string | null } | null;
}>();

const emit = defineEmits<{
  close: [];
  review: [invitationId: string];
  correctIdentity: [invitationId: string];
  orderTest: [order: { medstopId: string; zip: string | null }];
  closeOrder: [request: { requestId: string; status: MedstopCloseStatus }];
  recollect: [test: { testId: string; medstopId: string; collectedOn: string | null; zip: string | null }];
  openStep: [key: HiringStep["key"]];
}>();

/**
 * The instruction, but only while there is still something to do.
 *
 * ⚠ `action` is an imperative, and under a step that is already done it reads as an order to redo
 * it — *"Permissions signed / Sign the permissions / Done"*. Found by opening the drawer at 1440 on
 * 2026-09-18; every test was green, because a test asserting the instruction is present cannot see
 * that it is present at the wrong moment. The row's label is the whole title a finished row needs.
 */
const subtitle = computed(() =>
  props.row && props.row.state !== "done" ? props.row.lead.action : undefined,
);

/**
 * The wide drawer for two bodies: the application's, which holds the employment history table, and the
 * road test's (§14 OF3) — nine items each with a three-way rating, filled in by the examiner standing at
 * the truck on a tablet. At the default 448 px the item and its rating cannot sit side by side.
 */
const WIDE_BODIES = new Set(["application", "road_test"]);
const wide = computed(() => props.row?.steps.some((s) => WIDE_BODIES.has(hiringDrawerBody(s.key))) ?? false);
</script>

<template>
  <SlideOver
    :open="open"
    :title="row?.label ?? ''"
    :description="subtitle"
    :size="wide ? 'xl' : undefined"
    @close="emit('close')"
  >
    <div v-if="row" class="space-y-8">
      <!-- One step: its body is the drawer, as it always was. Two: each under its own heading, so the
           office sees which half is done and which is still owed. -->
      <section
        v-for="step in row.steps"
        :key="step.key"
        :aria-labelledby="row.steps.length > 1 ? `step-${step.key}` : undefined"
        :data-testid="`row-step-${step.key}`"
        class="space-y-3"
      >
        <h3 v-if="row.steps.length > 1" :id="`step-${step.key}`" class="text-sm font-semibold text-ink">
          {{ step.label }}
        </h3>
        <HiringStepBody
          :step="step"
          :driver-id="driverId"
          :driver-status="driverStatus"
          :invitation-id="invitationId"
          :identity="identity"
          @review="emit('review', $event)"
          @correct-identity="emit('correctIdentity', $event)"
          @order-test="emit('orderTest', $event)"
          @close-order="emit('closeOrder', $event)"
          @recollect="emit('recollect', $event)"
          @open-step="emit('openStep', $event)"
        />
      </section>
    </div>
  </SlideOver>
</template>
