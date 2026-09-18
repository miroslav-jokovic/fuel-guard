<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  AppButton as BaseButton,
  AppInput as BaseInput,
  AppFormField as FormField,
  AppSegmentedControl,
} from "@silvicom/ui";
import type { ApplyPacketStop } from "@/features/apply/useApplication";
import { usePacketCeremony } from "@/features/apply/signing/usePacketCeremony";
import SignaturePad from "@/features/apply/signing/SignaturePad.vue";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * One place on the carrier's packet, one screen (P5, D-PKT6, D-PKT13).
 *
 * ── WHAT IS ON THE SCREEN AT A STOP, AND WHY IT IS SO LITTLE ──────────────────────────────────
 * The carrier's page number, the sentence that page asks the driver to agree to, the mark about to
 * be applied, and one button. Nothing else — no summary of the twenty-two, no preview of the next,
 * no application fields. The driver has already read the whole application on the screen before this
 * one; what this screen is for is *being in one place on the paper at a time*, which is the whole of
 * what the owner meant by "navigated precisely from place to place".
 *
 * ⚠ **The page number is the carrier's, from their own footer**, and it is deliberately the one
 * number shown. It is printed at the foot of the sheet the driver will be handed, so it is the only
 * thing here they can check against the document itself.
 *
 * ⚠ **A stop asking for INITIALS says initials, and applies the initials.** The packet treats them
 * as a second mark rather than an abbreviation of the first — three pages take them and nothing else
 * — so a screen that said "sign" there would be describing a different act from the one being
 * performed, and a screen that previewed the full name there would be describing the right act with
 * the wrong mark. Until 2026-09-14 (Q-PKT8) the adoption collected one mark and this screen did
 * exactly that; the second field is on the adoption screen now, shown while any of the three is
 * still outstanding.
 *
 * ── PROGRESS COUNTS THE PACKET, NOT THE WORK LEFT ─────────────────────────────────────────────
 * "Place 7 of 22" counts against the whole document, including stops a previous session collected.
 * Counting only what is outstanding would renumber the stops under a driver who came back — their
 * fourth place would be called the first — and the number somebody is watching must not move.
 */
const props = defineProps<{
  token: string;
  stops: ApplyPacketStop[];
  carrier: string;
  /** What this link has already adopted (Q-PKT9). Null before the first mark, which is the norm. */
  adoptedMarks?: { signature: string | null; initials: string | null } | null;
}>();
/** Carries the adopted mark, because it is the §391.21(b)(12) signature now (D-PKT15). */
const emit = defineEmits<{ done: [signedName: string] }>();

const copy = APPLY_COPY.packet;
const ceremony = usePacketCeremony(
  computed(() => props.token),
  computed(() => props.stops),
  { adopted: computed(() => props.adoptedMarks ?? null) },
);

const STYLES = [
  { value: "typed", label: copy.styleTyped },
  { value: "drawn", label: copy.styleDrawn },
] as const;

/** D-PKT13: the driver picks how the mark is made, once, before the first place. */
const style = computed({
  get: () => ceremony.style.value,
  set: (v: string) => {
    ceremony.style.value = v === "drawn" ? "drawn" : "typed";
  },
});

const nameReady = computed(() => ceremony.adoptedName.value.trim().length >= 2);
const drawReady = computed(() => style.value !== "drawn" || ceremony.markBlob.value !== null);
/** ⚠ The same length the composable enforces, and the same reason: one initial is a real one. */
const initialsReady = computed(
  () => !ceremony.needsInitials.value || ceremony.adoptedInitials.value.trim().length >= 1,
);
/** What this stop puts on the page — read from the composable so the preview cannot disagree. */
const applying = computed(() =>
  ceremony.current.value ? ceremony.markFor(ceremony.current.value) : "",
);

/**
 * The drawing itself, shown at the stops that will carry it (A3).
 *
 * ⚠ **Previously this screen showed the TYPED name in drawn mode**, under a caption that said
 * *"We will put your signature on the page"*. Both halves came from different places — the caption
 * from `style`, the preview from `markFor()` — so the screen described the right act with the wrong
 * mark, all the way through twenty-two stops. `ceremony.currentShowsDrawing` is now the single
 * answer and both read it.
 *
 * ⚠ An object URL rather than a data URL, and revoked when the blob changes or the screen goes: a
 * signature pad blob is a few hundred KB and a driver who redraws four times would otherwise leave
 * four of them pinned for the life of the tab.
 */
const drawnUrl = ref<string | null>(null);
watch(
  () => ceremony.markBlob.value,
  (blob) => {
    if (drawnUrl.value) URL.revokeObjectURL(drawnUrl.value);
    drawnUrl.value = blob ? URL.createObjectURL(blob) : null;
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  if (drawnUrl.value) URL.revokeObjectURL(drawnUrl.value);
});

/**
 * Which sentence sits above the mark.
 *
 * ⚠ Derived from the same boolean the preview uses, never from `style` — that is the disagreement A3
 * fixed. A drawn-mode stop whose drawing did not upload says `applyingTyped`, because the typed name
 * is what lands there.
 */
const applyingLabel = computed(() => {
  if (ceremony.current.value?.mark === "initials") return copy.applyingInitials;
  return ceremony.currentShowsDrawing.value ? copy.applyingDrawn : copy.applyingTyped;
});

async function adoptAndStart(): Promise<void> {
  if ((await ceremony.adopt()) && ceremony.complete.value) emit("done", ceremony.adoptedName.value.trim());
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
 * Whether anything is still correctable, which is what the stop's Change button offers (A4).
 *
 * ⚠ **EITHER kind, not this stop's kind** — and walking the screen is what settled it. Gating on the
 * stop in front of the driver looked right and was wrong: after place 1 the signature is pinned, so
 * standing on place 2 (another signature) the button vanished — while the driver's INITIALS were
 * still changeable for another place. Somebody who remembered their typo at place 2 had no way back
 * until place 3, for no reason a person could see.
 *
 * ⚠ It matches `reopen()`'s own guard exactly, so the button can never lead to a refusal, and the
 * form it opens disables each pinned field with the count as the reason. The screen therefore never
 * hides a correction that is possible, and never offers one that is not.
 */
/**
 * Whether the adoption form is being met for the first time or REOPENED to correct something (A4).
 *
 * ⚠ Derived from the pin rather than from a flag this component sets: anything pinned means at least
 * one mark is already on the paper, which is exactly the condition under which the first-visit
 * wording stops being true.
 */
const reopenedToChange = computed(() => ceremony.pinnedKinds.value.size > 0);

const canChangeAnyMark = computed(
  () => ceremony.canChange("signature") || ceremony.canChange("initials"),
);

function changeHere(): void {
  ceremony.reopen();
}

async function signCurrent(): Promise<void> {
  await ceremony.sign();
  if (ceremony.complete.value) emit("done", ceremony.adoptedName.value.trim());
}
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

  <!-- One place. Nothing else on the screen. -->
  <section v-else-if="ceremony.current.value" class="space-y-4">
    <div class="flex items-baseline justify-between gap-4">
      <span class="text-xs font-medium text-ink-tertiary">
        {{ copy.page(ceremony.current.value.page) }}
      </span>
      <span class="text-xs text-ink-muted">
        {{ copy.counter(ceremony.position.value, ceremony.total.value) }}
      </span>
    </div>

    <!-- The carrier's own sentence for this place, and the only thing being agreed to here. -->
    <p class="rounded-surface bg-surface-muted p-4 text-base text-ink">
      {{ ceremony.current.value.what }}
    </p>

    <!-- ⚠ The mark this stop takes, not the signature. A page asking for initials that previewed the
         full name would be showing the driver something other than what lands on the paper — and a
         drawn-mode stop that previewed the TYPED name was doing exactly that until A3. -->
    <div>
      <p class="text-sm text-ink-muted">{{ applyingLabel }}</p>
      <!-- ⚠ The drawing itself, at the stops that carry it. `alt` is empty on purpose: the sentence
           above already says what this is, and "your drawn signature" read out twice is noise. -->
      <img
        v-if="ceremony.currentShowsDrawing.value && drawnUrl"
        :src="drawnUrl"
        alt=""
        class="mt-1 h-16 w-auto max-w-full object-contain object-left"
      />
      <p v-else class="signature-preview text-2xl text-ink">{{ applying }}</p>
    </div>

    <!--
      ⚠ A4: correct this mark, offered ONLY while the server would still take the correction.

      `canChange` reads `pinnedKinds`, which is derived from filed rows, so this appears exactly when
      `record_packet_mark` would accept a different spelling and never when it would answer DR035.
      The asymmetry is deliberate and is the whole value: the signature is pinned at place 1 and the
      initials not until place 3, so a driver who mistyped their initials can still fix them while
      standing on the first place that shows them — which is the moment they are most likely to
      notice, because it is the first time they see the mark in position.
    -->
    <div v-if="canChangeAnyMark">
      <BaseButton variant="ghost" size="sm" @click="changeHere">{{ copy.changeMark }}</BaseButton>
    </div>

    <!-- ⚠ The drawing did not save (A3). Said at every remaining stop rather than once, because a
         driver who missed one notice would otherwise sign the rest of the packet still believing
         their drawing was on it. It is not an error state: nothing is lost and the walk continues. -->
    <p v-if="ceremony.drawnMarkFailed.value" class="text-sm text-ink-secondary">
      {{ copy.drawFailed }}
    </p>

    <!--
      ⚠ Two refusals, two sentences (A0b). A rate-limited stop is not a fault and the driver's
      connection is fine — telling them to check their signal, which is what this said to every
      refusal alike, sends somebody off to fix a thing that is not broken. The limiter's sentence
      names the wait and says nothing is lost, both of which are true.
    -->
    <p v-if="ceremony.error.value" class="text-sm text-ink-secondary">
      {{ ceremony.rateLimited.value ? copy.tooFast : copy.failed }}
    </p>

    <div class="flex justify-end">
      <BaseButton variant="primary" :disabled="ceremony.working.value" @click="signCurrent">
        {{
          ceremony.working.value
            ? copy.working
            : ceremony.current.value.mark === "initials"
              ? copy.initialAction
              : copy.signAction
        }}
      </BaseButton>
    </div>
  </section>

  <!-- Every place collected. -->
  <section v-else class="space-y-2">
    <h2 class="text-lg font-semibold text-ink">{{ copy.doneHeading }}</h2>
    <p class="text-sm text-ink-muted">{{ copy.doneBody }}</p>
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
