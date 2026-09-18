<script setup lang="ts">
import { computed } from "vue";
import { hiringStep, packetDriverMarkCount, type HiringStep } from "@silvicom/shared";
import { AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { hiringStepStateBadge } from "@/lib/badges.recruiting";
import { hiringArtifactLink } from "@/features/recruitment/hiringArtifacts";
import { hiringDrawerBody } from "@/features/recruitment/hiringStepDrawers";
import ApplicationInviteCard from "@/features/recruitment/ApplicationInviteCard.vue";
import AuthorizationsPanel from "@/features/recruitment/AuthorizationsPanel.vue";
import EmploymentHistorySection from "@/features/recruitment/EmploymentHistorySection.vue";
import EmployerInquirySection from "@/features/recruitment/EmployerInquirySection.vue";
import PspRecordsSection from "@/features/recruitment/PspRecordsSection.vue";
import { useAuthorizationsQuery } from "@/features/recruitment/useAuthorizations";

/**
 * One step of the hire, opened from its checklist row (B6, `HIRING-UI-PLAN.md` §4.2).
 *
 * ── THE TITLE AND THE SUBTITLE ARE THE CATALOGUE'S, NOT THIS FILE'S ───────────────────────────
 * The heading is the step's `label` and the line under it is the step's `action` — the instruction,
 * which is exactly what a drawer exists to carry out ("Order the driving record"). Writing a third
 * string per step here would be a copy of `hiringSteps.ts` with a delay fuse, and B4 and B5 each
 * already paid for one of those.
 *
 * ── WHICH BODY, AND WHY SEVEN OF THEM HAVE NO AFFORDANCE YET ──────────────────────────────────
 * `hiringStepDrawers.ts` maps the step to its body and carries the argument. The short version: the
 * plan's sentence *"the five existing sections become drawer bodies"* describes a one-to-one mapping
 * that does not exist — five of the twelve emitted steps have a body today and seven do not, because
 * D1, D2 and C1 are the steps that build them. Those seven get a body that says what the step is,
 * what proves it and **where the act is performed today**, rather than a drawer opening onto nothing.
 *
 * ⚠ No nested drawer. `ApplicationReviewDrawer` is itself a `SlideOver`, so the application body
 * EMITS `review` and the page swaps one drawer for the other — two dialogs open at once is a focus
 * trap inside a focus trap.
 */
const props = defineProps<{
  open: boolean;
  step: HiringStep | null;
  driverId: string;
  driverStatus: string;
  /** The live invitation, resolved by the page. Null before one exists. */
  invitationId: string | null;
}>();

const emit = defineEmits<{ close: []; review: [invitationId: string] }>();

const body = computed(() => (props.step ? hiringDrawerBody(props.step.key) : null));
const badge = computed(() => (props.step ? hiringStepStateBadge(props.step.state) : null));

/**
 * Where the artifact is read, for the bodies whose whole job is to point at it.
 *
 * ⚠ Reads `step.evidence` and NOT `step.artifact`, and the difference is deliberate. B5 made
 * `artifact` null until the step is done, because naming a proof that does not exist is the failure
 * the artifact column was built to avoid. A drawer asks a different question: *where would I go to
 * do this*, which has the same answer before and after. So the row says nothing until there is
 * something, and the drawer says where regardless.
 */
const artifact = computed(() => {
  if (!props.step) return null;
  const evidence = props.step.evidence;
  if (!evidence) return null;
  return { ...evidence, ...hiringArtifactLink(evidence.table, props.driverId) };
});

/**
 * The instruction, but only while there is still something to do.
 *
 * ⚠ `action` is an imperative, and under a step that is already done it reads as an order to redo
 * it — *"Permissions signed / Sign the permissions / Done"*. Found by opening the drawer at 1440 on
 * 2026-09-18; every test was green, because a test asserting the instruction is present cannot see
 * that it is present at the wrong moment. The step's label is the whole title a finished step needs.
 */
const subtitle = computed(() =>
  props.step && props.step.state !== "done" ? props.step.action : undefined,
);

const blockedBy = computed(() =>
  props.step?.blockedBy ? hiringStep(props.step.blockedBy).label : null,
);

const driverId = computed(() => props.driverId);
const authorizationsQ = useAuthorizationsQuery(driverId);
</script>

<template>
  <SlideOver
    :open="open"
    :title="step?.label ?? ''"
    :description="subtitle"
    :size="body === 'application' ? 'xl' : undefined"
    @close="emit('close')"
  >
    <div v-if="step" class="space-y-6">
      <!-- The state, and the blocker in words when there is one. Same vocabulary as the row that
           opened this, from the same record — a drawer that re-worded the state would be a second
           answer to the question the row already answered. -->
      <div class="flex flex-wrap items-center gap-2">
        <span v-if="badge" :class="[BADGE_BASE, toneClass(badge.tone)]">
          <AppIcon :icon="badge.icon" class="size-3.5" aria-hidden="true" />
          {{ badge.label }}
        </span>
        <span v-if="blockedBy" class="text-xs text-ink-secondary">Needs: {{ blockedBy }}</span>
      </div>

      <ApplicationInviteCard
        v-if="body === 'invitation'"
        :driver-id="driverId"
        :driver-status="driverStatus"
        @review="emit('review', $event)"
      />

      <AuthorizationsPanel
        v-else-if="body === 'authorizations'"
        :rows="authorizationsQ.data.value ?? []"
        :loading="authorizationsQ.isLoading.value"
        :error="authorizationsQ.error.value ? 'The signed releases could not be loaded.' : null"
      />

      <template v-else-if="body === 'application'">
        <!-- ⚠ The §391.21(b)(10) history and the §391.23 investigation OF that history are here
             because they are the application's content, not because a row was free. ⚠ But the
             INQUIRY is not one of D-HM9's fourteen steps at all, despite being a §391.51 file
             requirement this product already builds — recorded as Q-HM9, because inventing a
             fifteenth step is a catalogue ruling and not a UI decision. -->
        <!-- ⚠ The application itself is a button and not this drawer's body: `ApplicationReviewDrawer`
             is a `SlideOver` of its own AND lives in `features/apply`, which this feature may not
             import. Both facts say the same thing — hand it up to the page. -->
        <BaseButton v-if="invitationId" size="sm" variant="primary" @click="emit('review', invitationId)">
          Open the application
        </BaseButton>
        <p v-else class="text-xs text-ink-muted">
          There is no live invitation to open — the application has not been started, or its link was
          revoked.
        </p>

        <EmploymentHistorySection :driver-id="driverId" />
        <EmployerInquirySection :driver-id="driverId" />
      </template>

      <PspRecordsSection v-else-if="body === 'psp'" :driver-id="driverId" />

      <!-- ⚠ The five recorded acts (D-HM6) and the packet. No affordance in this drawer yet, and
           saying so plainly is the point: D1, D2 and C1 build them. What it CAN do is take the
           reader to the page where the act is performed today, which is better than a dead drawer
           and honest about being a signpost rather than a workbench. -->
      <div v-else-if="body === 'recorded_act' || body === 'packet'" class="space-y-3">
        <p class="text-xs text-ink-secondary">
          <template v-if="body === 'packet'">
            The applicant signs this on their own link — {{ packetDriverMarkCount() }} places in the
            packet. The office has no view of the signing itself yet.
          </template>
          <template v-else>
            Recorded rather than fetched: a record pulled anywhere else still counts, and files the
            same way.
          </template>
        </p>
        <p v-if="artifact" class="text-xs text-ink-secondary">
          Proved by: <span class="font-medium text-ink">{{ artifact.label }}</span>
        </p>
        <BaseButton v-if="artifact?.to" :to="artifact.to" size="sm">
          Open the driver's qualification file
        </BaseButton>
      </div>

      <p v-else class="text-xs text-ink-muted">
        This step has nothing in the schema to prove it yet, so there is nothing to show.
      </p>
    </div>
  </SlideOver>
</template>
