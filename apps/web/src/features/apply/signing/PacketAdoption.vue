<script setup lang="ts">
import { computed } from "vue";
import {
  AppButton as BaseButton,
  AppInput as BaseInput,
  AppFormField as FormField,
  AppSegmentedControl,
} from "@silvicom/ui";
import type { ApplyPacketStop } from "@/features/apply/useApplication";
import type { usePacketCeremony } from "@/features/apply/signing/usePacketCeremony";
import SignaturePad from "@/features/apply/signing/SignaturePad.vue";
import PacketMarkStyles from "@/features/apply/signing/PacketMarkStyles.vue";
import PacketMarkUpload from "@/features/apply/signing/PacketMarkUpload.vue";
import { markRequiredFor, type AdoptedMarkStyle } from "@/features/apply/signing/usePacketAdoption";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * The three screens BEFORE the walk: a resumed link's pinned marks, the adoption form, and A4's
 * confirm step (D-PKT13, Q-PKT8, Q-PKT9, A4).
 *
 * Split out of `PacketCeremony.vue` ahead of C1, which puts the carrier's page itself on the stop
 * screen and needs the room — that file stood at 434 of the 500-line budget with 16 lines of
 * headroom. Nothing here changed but the file it lives in. ⚠ C2 is the step that grows these three
 * (Choose a style / Draw / Upload), so the seam is also where the next feature lands.
 *
 * ⚠ **`ceremony` is passed WHOLE, and that is deliberate** (Q-PKT11). `usePacketCeremony` returns
 * `{ ...adoption, …walk }` as one spread precisely so that no consumer can tell the two halves
 * apart; handing this component only the adoption members would rebuild, at the component boundary,
 * exactly the seam the composable's own comment argues against. It takes the same object its parent
 * holds, and the state machine stays in one instance.
 *
 * ⚠ **`drawnUrl` is a prop rather than made here.** The object URL belongs to whoever owns the blob's
 * lifetime, and both this screen and the stop screen show the drawing. Creating a second one here
 * would pin a second copy of a few hundred KB per redraw and leave the two to be revoked separately.
 */
const props = defineProps<{
  ceremony: ReturnType<typeof usePacketCeremony>;
  carrier: string;
  stops: ApplyPacketStop[];
  /** The drawn mark's object URL, owned by the parent. Null in typed mode and before the first draw. */
  drawnUrl: string | null;
}>();
/** Carries the adopted mark, because it is the §391.21(b)(12) signature now (D-PKT15). */
const emit = defineEmits<{ done: [signedName: string] }>();

const copy = APPLY_COPY.packet;
const ceremony = computed(() => props.ceremony);

/**
 * DocuSign's three, in DocuSign's order (C2).
 *
 * ⚠ **Choose a style comes first because it is the one that needs nothing from the driver.** They have
 * already typed their name for `signed_name`; the default face renders it before they press anything,
 * so the fastest path through this screen is to look at it and carry on. Draw and Upload are for
 * somebody who wants their own hand, which is a deliberate act and belongs behind a deliberate tap.
 */
const STYLES = [
  { value: "styled", label: copy.styleStyled },
  { value: "drawn", label: copy.styleDrawn },
  { value: "uploaded", label: copy.styleUploaded },
] as const;

/**
 * D-PKT13: the driver picks how the mark is made, once, before the first place.
 *
 * ⚠ **Switching tabs throws the previous tab's picture away, and it must.** All three converge on one
 * `markBlob` and one `signature_mark` row, so a drawing left behind after a switch to Upload would be
 * staged and printed while the screen showed an empty file picker — the screen-says-one-thing,
 * form-carries-another failure this whole step exists to close. The tabs each re-emit their own mark
 * on mount, so the one on screen is always the one in hand.
 */
const style = computed({
  get: () => ceremony.value.style.value,
  set: (v: string) => {
    const next = (STYLES.find((s) => s.value === v)?.value ?? "styled") as AdoptedMarkStyle;
    if (next === ceremony.value.style.value) return;
    ceremony.value.style.value = next;
    ceremony.value.markBlob.value = null;
  },
});

const styleId = computed({
  get: () => ceremony.value.styleId.value,
  set: (v: string) => {
    ceremony.value.styleId.value = v;
  },
});

const nameReady = computed(() => ceremony.value.adoptedName.value.trim().length >= 2);
/**
 * ⚠ Asked of `markRequiredFor` rather than spelled out again here. Which tabs demand an actual picture
 * is a rule about what a failure means — the composable's header argues it — and a copy of the list in
 * a template is a copy that is right until somebody adds a fourth tab.
 */
const markReady = computed(
  () => !markRequiredFor(style.value) || ceremony.value.markBlob.value !== null,
);
/** ⚠ The same length the composable enforces, and the same reason: one initial is a real one. */
const initialsReady = computed(
  () => !ceremony.value.needsInitials.value || ceremony.value.adoptedInitials.value.trim().length >= 1,
);

async function adoptAndStart(): Promise<void> {
  if ((await ceremony.value.adopt()) && ceremony.value.complete.value) {
    emit("done", ceremony.value.adoptedName.value.trim());
  }
}

/**
 * The pages the initials go on, for the confirm screen (A4).
 *
 * ⚠ Read off the STOPS, so it stays true if the packet gains a placement — it has gained one
 * mid-array before (p17, D-PKT12). De-duplicated and sorted, because a page could hold two.
 */
const initialsPages = computed(() =>
  [...new Set(props.stops.filter((s) => s.mark === "initials").map((s) => s.page))].sort(
    (a, b) => a - b,
  ),
);

/**
 * Whether the adoption form is being met for the first time or REOPENED to correct something (A4).
 *
 * ⚠ Derived from the pin rather than from a flag this component sets: anything pinned means at least
 * one mark is already on the paper, which is exactly the condition under which the first-visit
 * wording stops being true.
 */
const reopenedToChange = computed(() => ceremony.value.pinnedKinds.value.size > 0);
</script>

<template>
  <!--
    A RESUMED walk (Q-PKT9): the server already pinned these, so there is nothing to type. Shown
    rather than skipped, because a driver coming back deserves to see which mark is going on the
    remaining pages before they carry on putting it there.
  -->
  <section
    v-if="ceremony.state.value === 'adopting' && ceremony.alreadyAdopted.value"
    class="mx-auto w-full max-w-3xl space-y-4"
  >
    <div>
      <h2 class="text-lg font-semibold text-ink">{{ copy.resumedHeading }}</h2>
      <p class="mt-2 text-sm text-ink-muted">{{ copy.resumedBody }}</p>
      <p v-if="ceremony.collected.value.length" class="mt-2 text-sm text-ink-secondary">
        {{ copy.resumed(ceremony.collected.value.length) }}
      </p>
    </div>

    <div>
      <p class="text-sm text-ink-muted">{{ copy.applyingTyped }}</p>
      <p class="signature-preview text-2xl text-ink">{{ ceremony.adoptedName.value }}</p>
      <!-- ⚠ A resumed link may also have a PICTURE staged, and the name above is not it. Said rather
           than shown, because the bundle serves capture dates and never bytes (`markStaged`) — and
           left unsaid, this panel would show a driver the typed name under the heading *"The mark you
           are signing with"* while their own signature picture went on the remaining pages. -->
      <p v-if="ceremony.markCarriedOver.value" class="mt-1 text-sm text-ink-secondary">
        {{ copy.markCarriedOver }}
      </p>
    </div>

    <div v-if="ceremony.needsInitials.value">
      <p class="text-sm text-ink-muted">{{ copy.resumedInitialsLabel }}</p>
      <p class="signature-preview text-2xl text-ink">{{ ceremony.adoptedInitials.value }}</p>
    </div>

    <div class="flex justify-end">
      <BaseButton variant="primary" :disabled="ceremony.working.value" @click="adoptAndStart">
        {{ ceremony.working.value ? copy.working : copy.resumedAction }}
      </BaseButton>
    </div>
  </section>

  <!-- Adoption: once, before any place is shown. -->
  <section v-else-if="ceremony.state.value === 'adopting'" class="mx-auto w-full max-w-3xl space-y-4">
    <div>
      <h2 class="text-lg font-semibold text-ink">
        {{ ceremony.needsInitials.value ? copy.adoptHeadingWithInitials : copy.adoptHeading }}
      </h2>
      <!-- ⚠ A reopened form is a different errand from a first visit, and `adoptIntro` describes
           only the first ("Give your signature once below — then we take you to each place"). Shown
           on a form whose signature field is disabled, it points at the one thing they cannot do. -->
      <p class="mt-2 text-sm text-ink-muted">
        {{ reopenedToChange ? copy.changeIntro : copy.adoptIntro(carrier, ceremony.total.value) }}
      </p>
      <!-- A resumed link says so, rather than silently opening part-way through. -->
      <p v-if="ceremony.collected.value.length" class="mt-2 text-sm text-ink-secondary">
        {{ copy.resumed(ceremony.collected.value.length) }}
      </p>
    </div>

    <AppSegmentedControl v-model="style" :options="STYLES" :label="copy.styleLabel" />

    <!-- ⚠ Asked for even when the driver draws. `signed_name` is the record on every row (D-APP8),
         and the packet itself asks for a printed name beside the mark on page 22.
         ⚠ A4: DISABLED once the server has pinned this kind, with the count as the reason. A driver
         who came back to fix their initials at place 3 must not be able to edit a signature that is
         already on two pages — the server would answer DR035 and they could do nothing about it. -->
    <FormField v-slot="{ id }" :label="copy.adoptLabel" :hint="copy.adoptHint">
      <BaseInput
        :id="id"
        v-model="ceremony.adoptedName.value"
        autocomplete="name"
        :disabled="!ceremony.canChange('signature')"
      />
    </FormField>
    <p v-if="!ceremony.canChange('signature')" class="text-sm text-ink-secondary">
      {{ copy.markLocked("signature", ceremony.placesWithMark("signature")) }}
    </p>

    <!-- ⚠ The SECOND adopted mark (D-PKT6, Q-PKT8), not an abbreviation of the first. Typed by the
         driver even when they draw their signature, because `signed_name` is what goes on p05, p06
         and p09 — and shown only while one of those three is still outstanding. -->
    <template v-if="ceremony.needsInitials.value">
      <FormField v-slot="{ id }" :label="copy.initialsLabel" :hint="copy.initialsHint">
        <BaseInput
          :id="id"
          v-model="ceremony.adoptedInitials.value"
          autocomplete="off"
          :disabled="!ceremony.canChange('initials')"
        />
      </FormField>
      <p v-if="!ceremony.canChange('initials')" class="text-sm text-ink-secondary">
        {{ copy.markLocked("initials", ceremony.placesWithMark("initials")) }}
      </p>
      <p v-if="!initialsReady" class="text-sm text-ink-secondary">{{ copy.initialsNeeded }}</p>
    </template>

    <!-- ⚠ Shown only once there is a name worth drawing. The picker's whole job is to show the
         driver's OWN name in four hands, and four rows of a placeholder is a choice between
         specimens rather than between signatures. -->
    <PacketMarkStyles
      v-if="style === 'styled' && nameReady"
      v-model="styleId"
      :name="ceremony.adoptedName.value"
      @change="ceremony.markBlob.value = $event"
    />

    <!-- ⚠ The pad's OWN label and hint are replaced rather than a second line printed above it. Its
         defaults are A5's — "Draw it too, if you like", "Optional" — and here the drawing is the
         mark the driver chose, so the pad would have been telling them it was optional while the
         button below stayed disabled. -->
    <template v-else-if="style === 'drawn'">
      <SignaturePad
        :label="copy.drawLabel"
        :hint="copy.drawHint"
        @change="ceremony.markBlob.value = $event"
      />
      <p v-if="!markReady" class="text-sm text-ink-secondary">{{ copy.drawNeeded }}</p>
    </template>

    <PacketMarkUpload
      v-else-if="style === 'uploaded'"
      @change="ceremony.markBlob.value = $event"
    />

    <div class="flex justify-end">
      <BaseButton
        variant="primary"
        :disabled="ceremony.working.value || !nameReady || !initialsReady || !markReady"
        @click="adoptAndStart"
      >
        {{ ceremony.working.value ? copy.working : copy.adoptAction }}
      </BaseButton>
    </div>
  </section>

  <!--
    ⚠ A4: the step between the last keystroke and the first signature.

    `record_packet_mark` pins the adopted mark at the first stop OF ITS KIND (0340) and refuses a
    different spelling afterwards with DR035 — which, as the composable's own comment admitted, is
    advice the driver cannot act on. Before this there was nothing at all between typing an initial
    and it being permanent for a federal record.

    ⚠ It shows the marks in the face they will be PRINTED in, and the drawing itself when there is
    one, because a confirmation that renders the mark differently from the document is confirming
    something else. Same reasoning as A3's stop preview, one screen earlier.
  -->
  <section v-else-if="ceremony.state.value === 'confirming'" class="mx-auto w-full max-w-3xl space-y-4">
    <div>
      <h2 class="text-lg font-semibold text-ink">{{ copy.confirmHeading }}</h2>
      <p class="mt-2 text-sm text-ink-muted">{{ copy.confirmBody }}</p>
    </div>

    <div>
      <p class="text-sm text-ink-muted">{{ copy.confirmSignatureLabel }}</p>
      <!-- ⚠ No longer gated on `style === 'drawn'` (C2). All three tabs produce the picture the packet
           prints, so the question is whether there IS one — asking which tab made it would have hidden
           a styled mark behind a preview of the typed name it was made from. -->
      <!-- ⚠ `h-10`, and the number is DERIVED rather than chosen: the overlay draws a mark at up to
           `DRAWN_MARK_MAX_HEIGHT` (18pt) and typed text at `TYPED_MARK_SIZE` (11pt), so on paper a
           signature stands about 1.6× the initials beside it. The initials below render at `text-2xl`
           (24px), and 24 × 18/11 ≈ 40px. At the `h-16` a drawn mark used to get, the signature read
           nearly four times the initials — which on the one screen that says *"these go on the form
           exactly as they look here"* is the preview disagreeing with the paper about proportion
           while agreeing about everything else. -->
      <img
        v-if="!ceremony.drawnMarkFailed.value && drawnUrl"
        :src="drawnUrl"
        alt=""
        class="mt-1 h-10 w-auto max-w-full object-contain object-left"
      />
      <p v-else-if="ceremony.markCarriedOver.value" class="text-sm text-ink-secondary">
        {{ copy.markCarriedOver }}
      </p>
      <p v-else class="signature-preview text-2xl text-ink">{{ ceremony.adoptedName.value }}</p>
    </div>

    <!-- ⚠ Shown only while a stop still asks for initials, for `needsInitials`' own reason: a driver
         whose three initials places were collected yesterday has no initials to check. -->
    <div v-if="ceremony.needsInitials.value">
      <p class="text-sm text-ink-muted">{{ copy.confirmInitialsLabel }}</p>
      <p class="signature-preview text-2xl text-ink">{{ ceremony.adoptedInitials.value }}</p>
      <p class="mt-1 text-xs text-ink-tertiary">{{ copy.confirmInitialsWhere(initialsPages) }}</p>
    </div>

    <!-- ⚠ The drawing did not save (A3), said here too — this is the screen where the driver decides
         to go ahead, so it is the last place the promise can still be corrected before it matters. -->
    <p v-if="ceremony.drawnMarkFailed.value" class="text-sm text-ink-secondary">
      {{ copy.drawFailed }}
    </p>

    <div class="flex justify-end gap-2">
      <BaseButton variant="secondary" @click="ceremony.reopen">{{ copy.confirmChange }}</BaseButton>
      <BaseButton variant="primary" @click="ceremony.confirm">{{ copy.confirmAction }}</BaseButton>
    </div>
  </section>
</template>

<style scoped>
/*
 * ⚠ **This is the TYPED-TEXT face, and it is an oblique sans because that is what the packet prints.**
 *
 * It used to be a brush script — `ui-rounded, "Segoe Script", "Brush Script MT", cursive` — chosen so
 * a typed name would "read as a signature". Measured on 2026-09-19 by rendering `p03` with a typed
 * mark and rasterising it: `renderPacketOverlay` draws that branch in `StandardFonts.HelveticaOblique`,
 * a plain slanted sans. So the screen showed a brush script, the paper carried oblique Helvetica, and
 * `confirmBody` sat over the pair promising *"These go on the form exactly as they look here."*
 *
 * ⚠ Everywhere a mark is PRINTED as a picture the preview is now the picture itself (D-HUI14), so this
 * face is reached in exactly two places, and in both of them it is correct: the three initials lines,
 * which `takesDrawing` has always excluded (Q-HUI14), and a signature whose staging failed and which
 * therefore falls back to `drawText` (A8b, `drawnMarkFailed`).
 *
 * ⚠ A system stack, so it needs no webfont and cannot fail to load on a truck-stop connection.
 * Helvetica is named first because it IS the printed face on any machine that has it; the rest are the
 * usual metric-compatible stand-ins, and `sans-serif` is the floor.
 */
.signature-preview {
  font-family: Helvetica, Arial, "Liberation Sans", sans-serif;
  font-style: oblique 12deg;
}
</style>
