<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton, AppCallout } from "@silvicom/ui";
import type { ApplicationCaptureView } from "@silvicom/shared";
import SignOffFields from "@/features/apply/SignOffFields.vue";
import PacketCeremony from "@/features/apply/signing/PacketCeremony.vue";
import { APPLY_COPY } from "@/features/apply/strings";
import type { ApplicationDraft } from "@/features/apply/draft";
import type { ApplyEdit, ApplyPacketStop } from "@/features/apply/useApplication";

/**
 * The second visit, in full: what changed, the whole document, the packet, the filing (F4, P5).
 *
 * ── WHY THIS IS A COMPONENT AND NOT THREE BLOCKS ON `ApplyPage` ───────────────────────────────
 * It was three blocks on `ApplyPage`, and adding the packet walk to them pushed that file to 528
 * lines — over the 500 budget `lint:filesize` holds. Split along a real seam rather than waived:
 * everything here belongs to ONE phase of the link (`approved_at` set, `submitted_at` not), and
 * nothing here is reachable in any other phase. `ApplyPage` keeps the phase decisions; this owns
 * what the approved phase looks like.
 *
 * ── THE ORDER OF THE THREE IS FORCED, AND BY TWO RULES PULLING THE SAME WAY ───────────────────
 * D-AX12 puts the office's corrections above anything the driver affirms — §391.21(b)(12) can only
 * be signed honestly by somebody shown the entries somebody else changed. And `record_packet_mark`
 * refuses a mark once `submitted_at` is set (0339), so the walk cannot follow the filing even if
 * anybody wanted it to. Corrections, then the document, then the packet, then Send.
 *
 * ⚠ **Send is held until every place is signed, and the SERVER would not hold it.** Nothing in
 * `submitApplication` counts marks, so a packet could be filed today with blank signature lines —
 * which is the one outcome this whole step exists to prevent. Recorded as an open question in
 * `APPLICATION-PACKET-PLAN.md` rather than fixed here, because making the submission itself refuse
 * is a change to a regulated filing path and belongs with the decision about whether the
 * certification below is still the driver's second one.
 */
const props = defineProps<{
  token: string;
  carrier: string;
  edits: readonly ApplyEdit[];
  captures: readonly ApplicationCaptureView[];
  stops: readonly ApplyPacketStop[];
  /** What this link has already adopted, so a resumed walk does not ask for it again (Q-PKT9). */
  adoptedMarks?: { signature: string | null; initials: string | null } | null;
  sending: boolean;
  error: string | null;
}>();
const draft = defineModel<ApplicationDraft>({ required: true });
const emit = defineEmits<{ send: [] }>();

const copy = APPLY_COPY.signOff;

/**
 * Signed through, as the SERVER sees it — not as this tab does.
 *
 * A driver who signed twelve places yesterday and came back today has a link whose stops already
 * carry dates, and `packetSignedHere` only ever becomes true for a walk finished in this tab. Either
 * is enough; neither alone is.
 */
const packetSignedHere = ref(false);

/**
 * The walk finishing IS the certification (D-PKT15, owner 2026-09-14).
 *
 * ⚠ **`certified` and `signed_name` are still written, and must be.** They are `driverApplicationSchema`
 * fields on an APPEND-ONLY table: every application filed before today carries them, and a payload
 * that stopped doing so would stop re-parsing, which is the §390.32(d) reproducibility failure the
 * whole renderer exists to prevent. What changed is that the driver no longer TYPES them a second
 * time — they are the mark adopted for the packet, applied to the document the packet is.
 *
 * ⚠ The server does not take this on trust: `packetIsSignedThrough` refuses a submission whose
 * `signed_name` disagrees with the name `application_packet_marks` recorded. This fills the payload;
 * the database is what says the payload is honest.
 */
function packetSigned(signedName: string): void {
  packetSignedHere.value = true;
  draft.value.certified = true;
  draft.value.signed_name = signedName;
}
const packetDone = computed(
  () =>
    packetSignedHere.value
    || (props.stops.length > 0 && props.stops.every((s) => Boolean(s.signedAt))),
);

/** Nothing to walk means nothing to hold — a link served before P5 shipped has no stops at all. */
const blocked = computed(() => props.stops.length > 0 && !packetDone.value);
</script>

<template>
  <!--
    ⚠ C1 widened the apply layout for the packet walk, and everything that is a FORM or PROSE keeps
    its reading width regardless. `max-w-3xl` here is a no-op while the layout is itself 3xl — which
    is every screen but this one — so there is no conditional and no second source of truth about
    how wide the container is. Only the page-and-rail below uses the room.
  -->
  <div class="mx-auto w-full max-w-3xl">
    <AppCallout v-if="error" tone="caution" class="mb-4">{{ error }}</AppCallout>

    <SignOffFields
      v-model="draft"
      :carrier="carrier"
      :edits="edits"
      :captures="captures"
    />
  </div>

  <!-- P5/D-PKT6/D-PKT13: the carrier's own form, place by place — and, since C1, the page itself. -->
  <div v-if="stops.length" class="mt-8 border-t border-edge pt-6">
    <PacketCeremony
      :token="token"
      :stops="[...stops]"
      :carrier="carrier"
      :adopted-marks="adoptedMarks ?? null"
      @done="packetSigned"
    />
  </div>

  <div class="mx-auto mt-6 flex w-full max-w-3xl justify-end">
    <BaseButton variant="primary" :disabled="sending || blocked" @click="emit('send')">
      {{ sending ? copy.signing : copy.sign }}
    </BaseButton>
  </div>
</template>
