<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import type { ApplyPacketStop } from "@/features/apply/useApplication";
import { usePacketCeremony } from "@/features/apply/signing/usePacketCeremony";
import PacketAdoption from "@/features/apply/signing/PacketAdoption.vue";
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
 *
 * ── WHERE THE OTHER SCREENS WENT ──────────────────────────────────────────────────────────────
 * The three screens before the walk — a resumed link's pinned marks, the adoption form, and A4's
 * confirm step — are `PacketAdoption.vue`, split out ahead of C1 when this file stood at 434 of the
 * 500-line budget and the carrier's page still had to go on the stop. This file owns the WALK; that
 * one owns everything before it starts, which is also where C2's three tabs land.
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
 *
 * ⚠ It stays HERE, and is handed to `PacketAdoption` as a prop, because the confirm screen shows the
 * same drawing: one blob, one URL, one revoke.
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
  <!-- Everything before the walk starts: the resumed link, the adoption form, A4's confirm step. -->
  <PacketAdoption
    v-if="ceremony.state.value === 'adopting' || ceremony.state.value === 'confirming'"
    :ceremony="ceremony"
    :carrier="carrier"
    :stops="stops"
    :drawn-url="drawnUrl"
    @done="emit('done', $event)"
  />

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
