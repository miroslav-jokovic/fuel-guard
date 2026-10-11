<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { INVITE_TTL_DAYS_MAX, stoppedBeforeLinkExpires } from "@silvicom/shared";
import { AppButton as BaseButton, AppInput as BaseInput, AppFormField as FormField } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import ApplicationLinkOnce from "@/features/recruitment/ApplicationLinkOnce.vue";
import { useCreateApplicant } from "@/features/recruitment/useCreateApplicant";
import { useRecruitingSettings } from "@/features/recruitment/useRecruitingSettings";
import {
  findApplicantMatches,
  useCreateApplicationInvite,
  useSendApplicationLinkAgain,
  type ApplicantMatch,
  type ApplicationInviteDelivery,
} from "@/features/recruitment/useApplicationInvites";

/**
 * The front door (U1, D-UI1).
 *
 * ── WHY THIS EXISTS AT ALL ─────────────────────────────────────────────────────────────────────
 * A0–A11b built a complete §391.21 application — consent, a four-instrument ceremony, seven screens,
 * staged photographs, a rendered PDF — and the only way to reach it was to create a driver by hand
 * under Fleet, open them, find the Employment tab and mint a link there. The board named after
 * applicants offered no way to make one. That is `RECRUITING-SYSTEM-PLAN.md` §4's own rule broken:
 * "a route reachable by no link is the P0b incident again".
 *
 * ── TWO CALLS, AND THE SECOND ONE'S FAILURE IS NAMED ───────────────────────────────────────────
 * There is no endpoint that creates an applicant and mints their invitation together, and inventing
 * one for the web's convenience would put a recruitment concern inside the roster route. So this
 * does them in sequence — and says which half succeeded when the second fails, because the halfway
 * state is REAL and recoverable: the applicant now exists on the board, and their row's own
 * Application card mints the link. A drawer that reported "could not invite" and left a person on
 * the board unexplained would be the worse of the two lies.
 *
 * ── THE LINK *IS* EMAILED FROM HERE, AND THIS SAID OTHERWISE FOR LONGER THAN IT WAS TRUE ──────
 * When this drawer was written there was no email transport, so the field was a note to the office
 * and the recruiter carried the link themselves. `deliverApplicationInvite` (applicationInvites.ts)
 * sends it now, and production has had `MAIL_PROVIDER=brevo` set throughout — so an address typed
 * here has been producing a real email while the hint beside it said the opposite.
 *
 * ⚠ The contradiction was visible on this very screen: `ApplicationLinkOnce`, rendered a few lines
 * below, has always headlined the success case "Emailed to …". A recruiter who read the hint and
 * believed it would send the link a second time by hand — or, worse, not send it at all on the
 * assumption somebody else would. Corrected 2026-09-14, found while pre-flighting A2.
 *
 * The field stays OPTIONAL, and that part was always right: the link is shown once here and is
 * copyable whatever happened to the email, because `delivery.sent === false` is an outcome the
 * recruiter acts on rather than an error — see `ApplicationLinkOnce`'s header for the three
 * different people the three failure reasons belong to.
 *
 * ── IT ASKS WHETHER THEY ARE ALREADY HERE FIRST (C2e, Q-AX6) ──────────────────────────────────
 * Production held four `Marija Varmeda` rows, one per press of this drawer, each with its own empty
 * application. So before creating anybody it asks the board for an applicant with the same name or
 * email — archived ones too, which is where those four were — and offers "Send them the link again" on
 * that record: their own application, their own link, nothing duplicated. "This is someone else" still
 * adds them; two drivers can share a name.
 *
 * ── THIS LINK'S LIFETIME (Q-AW41) ─────────────────────────────────────────────────────────────
 * Left blank, the new link lives the carrier's own lifetime (Settings → Recruiting), which the api reads —
 * the field shows it as its placeholder and never sends it back, so a carrier's later change is never
 * frozen into a value this drawer happened to hold. Typed, it is this one link's override. It applies to a
 * NEW invitation only: "Send them the link again" keeps the applicant's invitation and extends it by the
 * carrier's lifetime, as every other re-send does.
 */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; created: [] }>();

const session = useSessionStore();
const toast = useToastStore();
const createApplicant = useCreateApplicant();
const createInvite = useCreateApplicationInvite();
const settingsQ = useRecruitingSettings();
const carrierDays = computed(() => settingsQ.data.value?.settings.invite_ttl_days ?? null);
/** When the carrier counts a driver as stopped — the office's alert (Q-AW50). */
const carrierHours = computed(() => settingsQ.data.value?.settings.reminder_after_hours ?? null);
const sendAgain = useSendApplicationLinkAgain();

/** Same gate the driver-page card uses — the section matrix, never a role literal. */
// SP5: the ORG'S answer (the `sections` claim), the one `requireSection("recruitment")` reads — not
// the shipped matrix, which an org's grant or narrowing of the section never reached.
const canInvite = computed(() => session.can("recruitment"));

const firstName = ref("");
const lastName = ref("");
const email = ref("");
/** Blank = the carrier's lifetime. */
const linkDays = ref("");
const link = ref<string | null>(null);
const delivery = ref<ApplicationInviteDelivery | null>(null);
/** Set only in the halfway state: the applicant exists and the invitation did not happen. */
const orphaned = ref<{ name: string; driverId: string } | null>(null);
/** Applicants already on the board who may be this person; null until asked (Q-AX6). */
const matches = ref<ApplicantMatch[] | null>(null);
const checking = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    firstName.value = "";
    lastName.value = "";
    email.value = "";
    linkDays.value = "";
    link.value = null;
    delivery.value = null;
    orphaned.value = null;
    matches.value = null;
  },
);
// A changed name or email is a different question; the old answer must not stand for it.
watch([firstName, lastName, email], () => (matches.value = null));

const overrideDays = computed<number | undefined>(() => (linkDays.value.trim() === "" ? undefined : Number(linkDays.value)));
const daysValid = computed(() => {
  const d = overrideDays.value;
  return d === undefined || (Number.isInteger(d) && d >= 1 && d <= INVITE_TTL_DAYS_MAX);
});
/**
 * Q-AW51: a link that dies before its driver counts as stopped means the office is never alerted. Checked
 * HERE, before the applicant is added — the api refuses it too, but only after this drawer has created the
 * applicant, which would leave them without a link.
 */
const daysOutlastDelay = computed(() => {
  const d = overrideDays.value;
  return d === undefined || carrierHours.value === null || stoppedBeforeLinkExpires(d, carrierHours.value);
});
const daysError = computed(() => {
  if (!daysValid.value) return `Between 1 and ${INVITE_TTL_DAYS_MAX} days.`;
  if (!daysOutlastDelay.value) {
    return `At least ${Math.floor(carrierHours.value! / 24) + 1} days: a driver counts as stopped after ${carrierHours.value} hours, and the office is alerted only while the link is open.`;
  }
  return undefined;
});
const ready = computed(
  () => firstName.value.trim() !== "" && lastName.value.trim() !== "" && daysValid.value && daysOutlastDelay.value,
);
const working = computed(
  () => checking.value || createApplicant.isPending.value || createInvite.isPending.value || sendAgain.isPending.value,
);

/** The press: ask the board first, and add only when nobody matches (or the office says it is not them). */
async function submit(): Promise<void> {
  if (!ready.value) return;
  const fullName = `${firstName.value.trim()} ${lastName.value.trim()}`;
  checking.value = true;
  try {
    matches.value = await findApplicantMatches(fullName, email.value.trim() || null);
  } catch (e) {
    toast.error("Could not check the applicant board", e instanceof Error ? e.message : undefined);
    return;
  } finally {
    checking.value = false;
  }
  if (matches.value.length === 0) await addNew();
}

/** The existing record's own link, sent again (or a new application on it, if theirs is finished). */
async function inviteAgain(match: ApplicantMatch): Promise<void> {
  try {
    const result = await sendAgain.mutateAsync({ driverId: match.id });
    link.value = result.link;
    delivery.value = result.delivery;
    emit("created");
  } catch (e) {
    toast.error("Could not send the link again", e instanceof Error ? e.message : undefined);
  }
}

async function addNew(): Promise<void> {
  const fullName = `${firstName.value.trim()} ${lastName.value.trim()}`;

  let driverId: string;
  try {
    const applicant = await createApplicant.mutateAsync({
      first_name: firstName.value.trim(),
      last_name: lastName.value.trim(),
      email: email.value.trim() || null,
    });
    driverId = applicant.id;
  } catch (e) {
    toast.error("Could not add the applicant", e instanceof Error ? e.message : undefined);
    return;
  }

  // From here the applicant EXISTS. Every exit below has to account for them.
  emit("created");

  try {
    const result = await createInvite.mutateAsync({
      driverId,
      email: email.value.trim() || null,
      expiresInDays: overrideDays.value,
    });
    link.value = result.link;
    delivery.value = result.delivery;
  } catch (e) {
    orphaned.value = { name: fullName, driverId };
    toast.error("The applicant was added, but the link was not created", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver :open="open" size="lg" title="Invite an applicant" @close="emit('close')">
    <div class="space-y-6">
      <p class="text-sm text-ink-muted">
        This adds them to the applicant board and creates the link that carries them to their own
        driver application. They fill it in and certify it themselves; their answers become the
        employment history and the record their qualification file is built from.
      </p>

      <template v-if="!link && !orphaned">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField v-slot="{ id }" label="First name">
            <BaseInput :id="id" v-model="firstName" autocomplete="off" />
          </FormField>
          <FormField v-slot="{ id }" label="Last name">
            <BaseInput :id="id" v-model="lastName" autocomplete="off" />
          </FormField>
        </div>
        <FormField
          v-slot="{ id }"
          label="Their email"
          hint="Optional — the link is emailed to this address. Leave it blank and you send the link yourself."
        >
          <BaseInput :id="id" v-model="email" type="email" placeholder="Optional" autocomplete="off" />
        </FormField>
        <FormField
          v-slot="{ id }"
          label="Link stays open for (days)"
          :hint="carrierDays === null
            ? 'Optional — leave blank for the carrier\'s setting.'
            : `Optional — leave blank for the carrier's setting, ${carrierDays} days.`"
          :error="daysError"
        >
          <BaseInput
            :id="id"
            v-model="linkDays"
            type="number"
            min="1"
            :max="INVITE_TTL_DAYS_MAX"
            inputmode="numeric"
            :placeholder="carrierDays === null ? '' : String(carrierDays)"
            class="max-w-32"
          />
        </FormField>
      </template>

      <!-- Q-AX6: the person may already be here. Their record, not a second one. -->
      <div v-if="!link && !orphaned && matches?.length" class="space-y-3 rounded-surface bg-surface-muted p-3" role="status">
        <p class="text-xs font-medium text-ink-secondary">Already on the applicant board?</p>
        <ul class="space-y-2">
          <li v-for="m in matches" :key="m.id" class="flex flex-wrap items-center justify-between gap-2">
            <span class="text-sm text-ink">
              {{ m.full_name }}<span v-if="m.email" class="text-ink-muted"> · {{ m.email }}</span>
              <span v-if="m.archived" class="text-ink-muted"> · archived</span>
            </span>
            <span class="flex gap-2">
              <BaseButton size="sm" variant="secondary" :to="`/recruitment/${m.id}`">Open their page</BaseButton>
              <BaseButton size="sm" variant="primary" :disabled="working" @click="inviteAgain(m)">
                Send them the link again
              </BaseButton>
            </span>
          </li>
        </ul>
        <p class="text-xs text-ink-muted">
          Sending it again keeps what they have already done. If this is a different person, add them anyway.
        </p>
        <BaseButton size="sm" variant="ghost" :disabled="working" @click="addNew">
          This is someone else — add them
        </BaseButton>
      </div>

      <ApplicationLinkOnce v-if="link" :link="link" :delivery="delivery" />

      <!-- The halfway state, named rather than hidden. The applicant is on the board and their own
           Application card is where the link is minted, so the recovery is one click and is said. -->
      <div v-else-if="orphaned" class="rounded-surface bg-surface-muted p-3">
        <p class="text-xs font-medium text-ink-secondary">Half of this worked</p>
        <p class="mt-1 text-sm text-ink-secondary">
          {{ orphaned.name }} is on the applicant board, and no application link was created. Nothing
          is lost — open their page and create the link there.
        </p>
        <div class="mt-3">
          <BaseButton size="sm" :to="`/recruitment/${orphaned.driverId}`">
            Open {{ orphaned.name }}
          </BaseButton>
        </div>
      </div>

      <p v-if="!canInvite" class="text-sm text-ink-secondary">
        Your role can read the applicant board but not add to it.
      </p>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton variant="ghost" :disabled="working" @click="emit('close')">
          {{ link || orphaned ? "Done" : "Cancel" }}
        </BaseButton>
        <BaseButton
          v-if="!link && !orphaned && !matches?.length"
          variant="primary"
          :disabled="!ready || working || !canInvite"
          @click="submit"
        >
          {{ working ? "Creating…" : "Add and create the link" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
