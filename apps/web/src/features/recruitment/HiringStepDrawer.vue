<script setup lang="ts">
import { computed } from "vue";
import {
  hiringStep,
  isHiringRecordedActStep,
  type HiringStep,
} from "@silvicom/shared";
import { AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { hiringStepStateBadge } from "@/lib/badges.recruiting";
import { hiringArtifactLink } from "@/features/recruitment/hiringArtifacts";
import { hiringDrawerBody } from "@/features/recruitment/hiringStepDrawers";
import ApplicationInviteCard from "@/features/recruitment/ApplicationInviteCard.vue";
import AuthorizationsPanel from "@/features/recruitment/AuthorizationsPanel.vue";
import ApplicantIdentityCorrection from "@/features/recruitment/ApplicantIdentityCorrection.vue";
import SendApplicationPanel from "@/features/recruitment/SendApplicationPanel.vue";
import OpenSigningPanel from "@/features/recruitment/OpenSigningPanel.vue";
import EmploymentHistorySection from "@/features/recruitment/EmploymentHistorySection.vue";
import EmployerInquirySection from "@/features/recruitment/EmployerInquirySection.vue";
import PspRecordsSection from "@/features/recruitment/PspRecordsSection.vue";
import RecordedActPanel from "@/features/recruitment/RecordedActPanel.vue";
import RoadTestPanel from "@/features/recruitment/RoadTestPanel.vue";
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
 * ⚠ Q-HM9 added a thirteenth emitted step on 2026-09-18 and it came WITH its affordance — the
 * inquiry section existed and had been parked in the application body — so the seven is unchanged.
 * ⚠ **D1 then discharged three of them on 2026-09-19**: the MVR, the Clearinghouse query and the
 * drug test open `RecordedActPanel`, which performs the act instead of naming where it is performed.
 * Four are left, and `hiringStepDrawers.ts` names what each is waiting for.
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
  /** The driver row's date of birth and licence (AF3), read by the page; null while it loads. */
  identity?: { date_of_birth?: string | null; cdl_number?: string | null; cdl_state?: string | null } | null;
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

/**
 * The step key, narrowed to one `RecordedActPanel` can file (D1).
 *
 * ⚠ Null rather than a cast. `hiringStepDrawers.ts` and `hiringEvidence.ts` are two files that have
 * to agree about which three steps are recordable, and a `step.key as HiringRecordedActStep` here
 * would compile on the day they stopped agreeing — which is the delay fuse this component's own
 * `Record<HiringStepKey, …>` was built to refuse.
 */
const recordedActStep = computed(() =>
  props.step && isHiringRecordedActStep(props.step.key) ? props.step.key : null,
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
        <span v-else-if="step.outstandingJurisdictions.length" class="text-xs text-ink-secondary">
          Still needed from: {{ step.outstandingJurisdictions.join(", ") }}
        </span>
      </div>

      <ApplicationInviteCard
        v-if="body === 'invitation'"
        :driver-id="driverId"
        :driver-status="driverStatus"
        @review="emit('review', $event)"
      />

      <template v-else-if="body === 'authorizations'">
        <AuthorizationsPanel
          :invitation-id="invitationId"
          :rows="authorizationsQ.data.value ?? []"
          :loading="authorizationsQ.isLoading.value"
          :error="authorizationsQ.error.value ? 'The signed releases could not be loaded.' : null"
        />
        <!-- AF3/D-AF8: identity is given with the permissions, and corrected here before screening. -->
        <ApplicantIdentityCorrection
          v-if="invitationId"
          :invitation-id="invitationId"
          :driver-id="driverId"
          :identity="identity ?? null"
        />
      </template>

      <SendApplicationPanel
        v-else-if="body === 'send_application' && invitationId"
        :invitation-id="invitationId"
        :driver-id="driverId"
      />

      <!-- AF5/D-AF3: the packet is signed in the office, on a link the office opens at the desk. -->
      <OpenSigningPanel
        v-else-if="body === 'packet' && invitationId"
        :invitation-id="invitationId"
        :driver-id="driverId"
      />

      <template v-else-if="body === 'application'">
        <!-- ⚠ The §391.21(b)(10) employment history is here because it IS the application's content.
             The §391.23 investigation OF that history used to be here too, parked, with a comment
             saying it was not one of D-HM9's steps despite being a §391.51 file requirement this
             product already builds. **Q-HM9 ruled it in on 2026-09-18**, so it has its own row and
             its own drawer (`body === 'investigation'`) and no longer rides along with this one. -->
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
      </template>

      <PspRecordsSection v-else-if="body === 'psp'" :driver-id="driverId" />

      <!-- ⚠ D1. The step key is passed to a prop typed as the three steps this panel can file, so a
           row wired to `"record"` without a kind behind it is a TYPE error here rather than a form
           that posts and 400s. `recordedActStep` is where that narrowing happens. -->
      <RecordedActPanel
        v-else-if="body === 'record' && recordedActStep"
        :driver-id="driverId"
        :step="recordedActStep"
        :done="step.state === 'done'"
        :outstanding-jurisdictions="step.outstandingJurisdictions"
      />

      <RoadTestPanel v-else-if="body === 'road_test'" :driver-id="driverId" :done="step.state === 'done'" />

      <!-- ⚠ Q-HM9's step. The section is unchanged — it was already the whole §391.23(c)(2) record,
           it simply had no row to open it. What the row adds is that the investigation is now
           COUNTED: it blocks Hired, so nobody reaches the end of the checklist with it untouched. -->
      <EmployerInquirySection v-else-if="body === 'investigation'" :driver-id="driverId" />

      <!-- ⚠ The five recorded acts (D-HM6) and the packet. No affordance in this drawer yet, and
           saying so plainly is the point: D1, D2 and C1 build them. What it CAN do is take the
           reader to the page where the act is performed today, which is better than a dead drawer
           and honest about being a signpost rather than a workbench. -->
      <div v-else-if="body === 'recorded_act' || body === 'packet'" class="space-y-3">
        <p class="text-xs text-ink-secondary">
          <template v-if="body === 'packet'">
            The applicant signs this in the office. There is no live invitation to open signing on.
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
