<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { rolesThatManage } from "@silvicom/shared";
import { AppButton as BaseButton, AppInput as BaseInput, AppFormField as FormField } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import ApplicationLinkOnce from "@/features/recruitment/ApplicationLinkOnce.vue";
import { useCreateApplicant } from "@/features/recruitment/useCreateApplicant";
import {
  useCreateApplicationInvite,
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
 */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; created: [] }>();

const session = useSessionStore();
const toast = useToastStore();
const createApplicant = useCreateApplicant();
const createInvite = useCreateApplicationInvite();

/** Same gate the driver-page card uses — the section matrix, never a role literal. */
const canInvite = computed(() => {
  const role = session.role;
  return Boolean(role) && rolesThatManage("recruitment").includes(role!);
});

const firstName = ref("");
const lastName = ref("");
const email = ref("");
const link = ref<string | null>(null);
const delivery = ref<ApplicationInviteDelivery | null>(null);
/** Set only in the halfway state: the applicant exists and the invitation did not happen. */
const orphaned = ref<{ name: string; driverId: string } | null>(null);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    firstName.value = "";
    lastName.value = "";
    email.value = "";
    link.value = null;
    delivery.value = null;
    orphaned.value = null;
  },
);

const ready = computed(() => firstName.value.trim() !== "" && lastName.value.trim() !== "");
const working = computed(() => createApplicant.isPending.value || createInvite.isPending.value);

async function submit(): Promise<void> {
  if (!ready.value) return;
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
      </template>

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
          v-if="!link && !orphaned"
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
