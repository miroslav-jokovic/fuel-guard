<script setup lang="ts">
import { computed } from "vue";
import {
  AUTHORIZATION_PURPOSE_LABELS,
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
import { useSessionStore } from "@/stores/session";
import ApplicationInviteCard from "@/features/recruitment/ApplicationInviteCard.vue";
import AuthorizationsPanel from "@/features/recruitment/AuthorizationsPanel.vue";
import ApplicantIdentityCorrection from "@/features/recruitment/ApplicantIdentityCorrection.vue";
import SendApplicationPanel from "@/features/recruitment/SendApplicationPanel.vue";
import SendForSigningPanel from "@/features/recruitment/SendForSigningPanel.vue";
import EmploymentHistorySection from "@/features/recruitment/EmploymentHistorySection.vue";
import EmployerInquirySection from "@/features/recruitment/EmployerInquirySection.vue";
import PspRecordsSection from "@/features/recruitment/PspRecordsSection.vue";
import RecordedActPanel from "@/features/recruitment/RecordedActPanel.vue";
import RoadTestPanel from "@/features/recruitment/RoadTestPanel.vue";
import HandbookPanel from "@/features/recruitment/HandbookPanel.vue";
import TravelPanel from "@/features/recruitment/TravelPanel.vue";
import OrientationVideosPanel from "@/features/recruitment/OrientationVideosPanel.vue";
import DrugTestPanel from "@/features/recruitment/DrugTestPanel.vue";
import MedstopTestCard from "@/features/recruitment/MedstopTestCard.vue";
import ClearinghouseConsentPanel from "@/features/recruitment/ClearinghouseConsentPanel.vue";
import EmployerCallsPanel from "@/features/recruitment/EmployerCallsPanel.vue";
import SelfieCheckPanel from "@/features/recruitment/SelfieCheckPanel.vue";
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

// `orderTest` (UX4): the drug-test step's Med-Stop card asks for the order drawer, which the page
// opens in place of this one — for the reason `review` is emitted rather than opened here.
// `openStep` (§9 P2, D-2): a body that cannot work yet hands the office to the row that comes first.
const emit = defineEmits<{
  close: [];
  review: [invitationId: string];
  orderTest: [medstopId: string];
  openStep: [key: HiringStep["key"]];
}>();

/**
 * D-3 (§9 P2): the qualification file is written by `roster: manage` (the compliance routes' gate), so
 * its link is offered only to a role that can act there; anybody else is told who records it.
 * The same answer gates the hire (SP5), which is why the hired row can say who hires.
 */
const session = useSessionStore();
const canWriteFile = computed(() => session.can("roster"));

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
const advisedFirst = computed(() =>
  props.step?.advisedFirst ? hiringStep(props.step.advisedFirst).label : null,
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
        <!-- §9 P4: the owner's order as advice — never a refusal. -->
        <span v-else-if="advisedFirst" class="text-xs text-ink-muted" data-testid="advised-first-line">
          Usually after: {{ advisedFirst }}
        </span>
        <span v-else-if="step.outstandingJurisdictions.length" class="text-xs text-ink-secondary">
          Still needed from: {{ step.outstandingJurisdictions.join(", ") }}
        </span>
        <!-- A-4: the link will never ask for these again, so the paper door below is the only way. -->
        <span v-else-if="step.paperOnlyPurposes.length" class="text-xs text-ink-secondary">
          Their link no longer asks for {{ step.paperOnlyPurposes.map((p) => AUTHORIZATION_PURPOSE_LABELS[p]).join(", ") }}.
          Record {{ step.paperOnlyPurposes.length === 1 ? "it" : "them" }} on paper below.
        </span>
      </div>

      <ApplicationInviteCard
        v-if="body === 'invitation'"
        :driver-id="driverId"
        :driver-status="driverStatus"
        @review="emit('review', $event)"
      />

      <!-- §7 (D-AW1): Part 1 is the applicant's, on their link, so the office's levers are the link's. -->
      <template v-else-if="body === 'intake'">
        <p class="text-xs text-ink-secondary">
          The applicant fills in Part 1 on their link: who they are, their address, their licences and
          photos. Check their photo against their licence below.
        </p>
        <ApplicationInviteCard
          :driver-id="driverId"
          :driver-status="driverStatus"
          @review="emit('review', $event)"
        />
        <!-- AW6 (§6.7): the one thing the office DOES on Part 1 — look at the selfie beside the licence. -->
        <SelfieCheckPanel :driver-id="driverId" />
      </template>

      <template v-else-if="body === 'authorizations'">
        <AuthorizationsPanel
          :invitation-id="invitationId"
          :driver-id="driverId"
          :rows="authorizationsQ.data.value ?? []"
          :loading="authorizationsQ.isLoading.value"
          :error="authorizationsQ.error.value ? 'Could not load the signed releases.' : null"
          :retrying="authorizationsQ.isFetching.value"
          @retry="authorizationsQ.refetch()"
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

      <!-- D-AW14 (C3s3a): the packet is signed on the applicant's phone, on a link the office sends from the desk. -->
      <SendForSigningPanel
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
        <p v-else class="text-xs text-ink-muted">No application yet. Send the invitation first.</p>

        <EmploymentHistorySection :driver-id="driverId" />
      </template>

      <PspRecordsSection v-else-if="body === 'psp'" :driver-id="driverId" />

      <!-- ⚠ D1. The step key is passed to a prop typed as the three steps this panel can file, so a
           row wired to `"record"` without a kind behind it is a TYPE error here rather than a form
           that posts and 400s. `recordedActStep` is where that narrowing happens. -->
      <template v-else-if="body === 'record' && recordedActStep">
        <RecordedActPanel
          :driver-id="driverId"
          :step="recordedActStep"
          :done="step.state === 'done'"
          :outstanding-jurisdictions="step.outstandingJurisdictions"
        />
        <!-- C2b3: what the office arranges around two of the acts — never what proves them. The
             Clearinghouse row rests on the driver until their portal consent is recorded (D-AW5), so
             the row's own state is the consent's reading. -->
        <DrugTestPanel v-if="step.key === 'drug_test'" :driver-id="driverId" :done="step.state === 'done'" />
        <!-- MS2c (MEDSTOP-PLAN F-4): the same step as Med-Stop sees it — order, stage, expected by.
             Renders nothing for a carrier that has not connected Med-Stop. -->
        <MedstopTestCard v-if="step.key === 'drug_test'" :driver-id="driverId" @order="emit('orderTest', $event)" />
        <ClearinghouseConsentPanel
          v-if="step.key === 'clearinghouse'"
          :driver-id="driverId"
          :consented="step.state !== 'waiting_on_them'"
          :done="step.state === 'done'"
        />
      </template>

      <!-- §9 P1: the licence (RT-A1) and the step advised first (RT-A10) come from what this drawer holds. -->
      <RoadTestPanel
        v-else-if="body === 'road_test'"
        :driver-id="driverId"
        :done="step.state === 'done'"
        :invitation-id="invitationId"
        :identity="identity ?? null"
        :advised-first="step.key === 'road_test' && step.advisedFirst === 'drug_test' ? advisedFirst : null"
      />
      <HandbookPanel v-else-if="body === 'handbook'" :driver-id="driverId" :done="step.state === 'done'" />
      <TravelPanel v-else-if="body === 'travel'" :driver-id="driverId" />
      <OrientationVideosPanel v-else-if="body === 'videos'" :driver-id="driverId" />

      <!-- ⚠ Q-HM9's step. The section is unchanged — it was already the whole §391.23(c)(2) record,
           it simply had no row to open it. What the row adds is that the investigation is now
           COUNTED: it blocks Hired, so nobody reaches the end of the checklist with it untouched. -->
      <!-- D-AW8 (C2b3): the calls made before filing sit above the list filing copies them onto. -->
      <template v-else-if="body === 'investigation'">
        <EmployerCallsPanel :driver-id="driverId" />
        <EmployerInquirySection :driver-id="driverId" />
      </template>

      <!-- D-2 (§9 P2): sending the form or the packet needs the invitation's link — say so, and open
           the row that sends it, instead of a dead end. -->
      <div v-else-if="body === 'send_application' || body === 'packet'" class="space-y-3" data-testid="needs-invitation">
        <p class="text-xs text-ink-secondary">Send the invitation first — this goes out on the same link.</p>
        <BaseButton size="sm" @click="emit('openStep', 'invitation_sent')">Send the invitation</BaseButton>
      </div>

      <!-- The medical certificate (D-HM6): recorded in the qualification file, where the office keeps it.
           D-3: the link only for a role that can write there; anybody else is told who can. -->
      <div v-else-if="body === 'recorded_act'" class="space-y-3">
        <p class="text-xs text-ink-secondary">
          Record the {{ artifact?.label?.toLowerCase() ?? "record" }} in the driver's qualification file.
        </p>
        <BaseButton v-if="artifact?.to && canWriteFile" :to="artifact.to" size="sm">
          Open the driver's qualification file
        </BaseButton>
        <p v-else-if="artifact?.to" class="text-xs text-ink-muted" data-testid="ask-file-keeper">
          Ask a safety manager or an administrator to record it there.
        </p>
      </div>

      <!-- D-1 (§9 P2): the page opens HireDrawer for anybody who may hire; this is what everybody else,
           and a hire already done, sees. -->
      <div v-else-if="body === 'hire'" class="space-y-3" data-testid="hire-body">
        <p v-if="step.state === 'done'" class="text-xs text-ink-secondary">Hired. They are on the roster.</p>
        <p v-else class="text-xs text-ink-secondary">
          Hiring puts them on the roster, so it needs roster access. Ask an administrator to hire them, or to
          give your role roster access in Settings → Permissions.
        </p>
      </div>

      <p v-else class="text-xs text-ink-muted">Nothing to record here yet.</p>
    </div>
  </SlideOver>
</template>
