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

const STYLES = [
  { value: "typed", label: copy.styleTyped },
  { value: "drawn", label: copy.styleDrawn },
] as const;

/** D-PKT13: the driver picks how the mark is made, once, before the first place. */
const style = computed({
  get: () => ceremony.value.style.value,
  set: (v: string) => {
    ceremony.value.style.value = v === "drawn" ? "drawn" : "typed";
  },
});

const nameReady = computed(() => ceremony.value.adoptedName.value.trim().length >= 2);
const drawReady = computed(
  () => style.value !== "drawn" || ceremony.value.markBlob.value !== null,
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
    class="space-y-4"
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
  <section v-else-if="ceremony.state.value === 'adopting'" class="space-y-4">
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

    <template v-if="style === 'typed'">
      <p v-if="nameReady" class="text-sm text-ink-muted">{{ copy.applyingTyped }}</p>
      <!-- A script face, so it reads as a signature. It is a rendering of the typed name and nothing
           more — the legally load-bearing artifact is the row the server writes (D-APP8). -->
      <p v-if="nameReady" class="signature-preview text-2xl text-ink">
        {{ ceremony.adoptedName.value }}
      </p>
    </template>

    <!-- ⚠ The pad's OWN label and hint are replaced rather than a second line printed above it. Its
         defaults are A5's — "Draw it too, if you like", "Optional" — and here the drawing is the
         mark the driver chose, so the pad would have been telling them it was optional while the
         button below stayed disabled. -->
    <template v-else>
      <SignaturePad
        :label="copy.drawLabel"
        :hint="copy.drawHint"
        @change="ceremony.markBlob.value = $event"
      />
      <p v-if="!drawReady" class="text-sm text-ink-secondary">{{ copy.drawNeeded }}</p>
    </template>

    <div class="flex justify-end">
      <BaseButton
        variant="primary"
        :disabled="ceremony.working.value || !nameReady || !initialsReady || !drawReady"
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
  <section v-else-if="ceremony.state.value === 'confirming'" class="space-y-4">
    <div>
      <h2 class="text-lg font-semibold text-ink">{{ copy.confirmHeading }}</h2>
      <p class="mt-2 text-sm text-ink-muted">{{ copy.confirmBody }}</p>
    </div>

    <div>
      <p class="text-sm text-ink-muted">{{ copy.confirmSignatureLabel }}</p>
      <img
        v-if="style === 'drawn' && !ceremony.drawnMarkFailed.value && drawnUrl"
        :src="drawnUrl"
        alt=""
        class="mt-1 h-16 w-auto max-w-full object-contain object-left"
      />
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
/* Cursive is a system-stack keyword, so this needs no webfont and cannot fail to load on a
   truck-stop connection. Same face as `SigningCeremony`'s, deliberately: one signature, shown the
   same way wherever the driver meets it. */
.signature-preview {
  font-family: ui-rounded, "Segoe Script", "Brush Script MT", cursive;
}
</style>
