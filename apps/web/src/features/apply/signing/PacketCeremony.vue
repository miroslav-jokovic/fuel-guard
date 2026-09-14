<script setup lang="ts">
import { computed } from "vue";
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
 * ⚠ **A stop asking for INITIALS says initials.** The packet treats them as a second mark rather
 * than an abbreviation of the first — three pages take them and nothing else — so a screen that said
 * "sign" there would be describing a different act from the one being performed.
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
}>();
/** Carries the adopted mark, because it is the §391.21(b)(12) signature now (D-PKT15). */
const emit = defineEmits<{ done: [signedName: string] }>();

const copy = APPLY_COPY.packet;
const ceremony = usePacketCeremony(
  computed(() => props.token),
  computed(() => props.stops),
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

async function adoptAndStart(): Promise<void> {
  if ((await ceremony.adopt()) && ceremony.complete.value) emit("done", ceremony.adoptedName.value.trim());
}

async function signCurrent(): Promise<void> {
  await ceremony.sign();
  if (ceremony.complete.value) emit("done", ceremony.adoptedName.value.trim());
}
</script>

<template>
  <!-- Adoption: once, before any place is shown. -->
  <section v-if="ceremony.state.value === 'adopting'" class="space-y-4">
    <div>
      <h2 class="text-lg font-semibold text-ink">{{ copy.adoptHeading }}</h2>
      <p class="mt-2 text-sm text-ink-muted">{{ copy.adoptIntro(carrier, ceremony.total.value) }}</p>
      <!-- A resumed link says so, rather than silently opening part-way through. -->
      <p v-if="ceremony.collected.value.length" class="mt-2 text-sm text-ink-secondary">
        {{ copy.resumed(ceremony.collected.value.length) }}
      </p>
    </div>

    <AppSegmentedControl v-model="style" :options="STYLES" :label="copy.styleLabel" />

    <!-- ⚠ Asked for even when the driver draws. `signed_name` is the record on every row (D-APP8),
         and the packet itself asks for a printed name beside the mark on page 22. -->
    <FormField v-slot="{ id }" :label="copy.adoptLabel" :hint="copy.adoptHint">
      <BaseInput :id="id" v-model="ceremony.adoptedName.value" autocomplete="name" />
    </FormField>

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
        :disabled="ceremony.working.value || !nameReady || !drawReady"
        @click="adoptAndStart"
      >
        {{ ceremony.working.value ? copy.working : copy.adoptAction }}
      </BaseButton>
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

    <div>
      <p class="text-sm text-ink-muted">
        {{ style === 'drawn' ? copy.applyingDrawn : copy.applyingTyped }}
      </p>
      <p class="signature-preview text-2xl text-ink">{{ ceremony.adoptedName.value }}</p>
    </div>

    <p v-if="ceremony.error.value" class="text-sm text-ink-secondary">{{ copy.failed }}</p>

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
