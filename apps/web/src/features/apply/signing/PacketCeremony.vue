<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import type { ApplyPacketStop } from "@/features/apply/useApplication";
import { usePacketCeremony } from "@/features/apply/signing/usePacketCeremony";
import PacketAdoption from "@/features/apply/signing/PacketAdoption.vue";
import PacketPageRail from "@/features/apply/signing/PacketPageRail.vue";
import PacketPageView from "@/features/apply/signing/PacketPageView.vue";
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
  /**
   * Whether a signature picture was staged on a previous visit (C2).
   *
   * ⚠ Passed in rather than derived here: `SignOffScreen` holds the served captures and already knows
   * the slot vocabulary, and a second reader of `captures` on this side would be a second place the
   * fact *"this link has a mark"* is decided. `usePacketAdoption`'s `markStaged` carries why it is
   * needed at all.
   */
  markStaged?: boolean;
}>();
/** Carries the adopted mark, because it is the §391.21(b)(12) signature now (D-PKT15). */
const emit = defineEmits<{ done: [signedName: string] }>();

const copy = APPLY_COPY.packet;
const ceremony = usePacketCeremony(
  computed(() => props.token),
  computed(() => props.stops),
  {
    adopted: computed(() => props.adoptedMarks ?? null),
    markStaged: computed(() => Boolean(props.markStaged)),
  },
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

/**
 * Which page the driver is LOOKING at (C1).
 *
 * ⚠ **Derived with an override that expires, never a stored cursor.** The handoff's warning for C1
 * is that a page index is A4's stranded-walk defect one level up: `current` is the first stop nobody
 * has filed, and anything that remembers a position instead of deriving one goes wrong the moment
 * the list is refetched — `refetchOnWindowFocus` is on by default.
 *
 * So this holds only a DEPARTURE from the derived answer. `looking` falls back to `current` whenever
 * the override is null, and the watcher below clears the override the instant the signing position
 * moves, which carries the driver to the next place the moment they sign rather than leaving them
 * reading page 14. Nothing here can change where they are SIGNING; that stays the composable's.
 */
const lookingOverride = ref<string | null>(null);
const looking = computed<ApplyPacketStop | null>(() => {
  const override = lookingOverride.value
    ? (props.stops.find((s) => s.id === lookingOverride.value) ?? null)
    : null;
  return override ?? ceremony.current.value;
});
watch(
  () => ceremony.current.value?.id ?? null,
  () => {
    lookingOverride.value = null;
  },
);
/** True while the driver has wandered off the place they are being asked to sign. */
const lookingAway = computed(
  () => Boolean(ceremony.current.value) && looking.value?.id !== ceremony.current.value?.id,
);

/**
 * Where the packet's bytes come from.
 *
 * ⚠ **Keyed on the token ALONE, and deliberately not on the mark count.** The first draft of this
 * line put `filed` in the query so that a driver looking back at place 3 would see the signature
 * they had just applied. That is a refetch of a thirty-one-page document after every one of
 * twenty-two marks — and A0b's measurement is that everything on this prefix except `POST …/mark`
 * falls to the **intake bucket at 20 requests per minute**. Twenty-two refetches inside one walk
 * exceeds it, and the driver would be stopped mid-ceremony by a limiter, which is the exact defect
 * A0b existed to fix ([[packet-ceremony-outruns-the-rate-limiter]]).
 *
 * So the document is what the carrier's paper looked like **when this screen opened**. That is
 * precisely D-HUI11's case — a driver resuming at stop 8 sees the seven signatures a previous
 * session left — and the cost is that a signature applied in THIS session is not redrawn. The
 * screen says so rather than letting the two disagree silently; see `signedHereNotOnPage`.
 */
const packetSrc = computed(
  () => `/api/public/application/${encodeURIComponent(props.token)}/packet`,
);

/**
 * ⚠ The one place the rail and the page can legitimately disagree, said out loud.
 *
 * A stop the driver signed in THIS session is done — the rail marks it done, the server has the row
 * — but the PDF on screen was fetched before that mark existed, so its signature line is still
 * blank. Saying nothing would be the A3 failure in miniature: a screen showing one thing about a
 * document while asserting another. One sentence costs nothing and is true.
 */
const signedHereNotOnPage = computed(
  () => Boolean(looking.value) && !looking.value?.signedAt && ceremony.signedHere.value.has(looking.value?.id ?? ""),
);

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

  <!-- One place — and now the page it is on (C1). -->
  <section v-else-if="ceremony.current.value" class="space-y-4">
    <div class="flex items-baseline justify-between gap-4">
      <span class="text-xs font-medium text-ink-tertiary">
        {{ copy.page(ceremony.current.value.page) }}
      </span>
      <span class="text-xs text-ink-muted">
        {{ copy.counter(ceremony.position.value, ceremony.total.value) }}
      </span>
    </div>

    <!--
      ⚠ The page and the sentence, BOTH, at every width — D-HUI9, and it is a measurement rather
      than a preference. At 390px the packet's body text rasterises at ~6 CSS px: the page is
      recognisable as a shape, which is what tells the driver where they are on the carrier's paper,
      and its words cannot be read. So the sentence beside it carries the meaning and the page
      carries the place. At 765px the page itself is readable, which is the width `ApplyLayout`
      already had. ⚠ Pinch-zoom stays enabled; never `user-scalable=no`.
    -->
    <div class="lg:flex lg:items-start lg:gap-x-6">
      <div class="lg:order-2 lg:min-w-0 lg:flex-1">
        <PacketPageView
          :src="packetSrc"
          :page="looking?.page ?? ceremony.current.value.page"
          :label="`Page ${looking?.page ?? ceremony.current.value.page} of the carrier's application`"
        />
      </div>

      <!-- A strip above the page on a phone, a column beside it with room. -->
      <div class="mt-4 lg:order-1 lg:mt-0 lg:w-44 lg:shrink-0">
        <PacketPageRail
          :stops="stops"
          :current-id="ceremony.current.value.id"
          :looking-id="looking?.id ?? null"
          :signed-ids="ceremony.signedHere.value"
          @look="lookingOverride = $event"
        />
      </div>
    </div>

    <!-- ⚠ The driver has wandered off the place being signed. Said plainly, with the way back, so
         the Sign button below can never be mistaken for signing the page on screen. -->
    <p v-if="lookingAway" class="text-sm text-ink-secondary">
      You are reading page {{ looking?.page }}. The place you are signing is on page
      {{ ceremony.current.value.page }}.
      <BaseButton variant="ghost" size="sm" @click="lookingOverride = null">
        Take me back
      </BaseButton>
    </p>

    <!-- ⚠ The one place the rail and the page may legitimately disagree — see the computed. -->
    <p v-else-if="signedHereNotOnPage" class="text-sm text-ink-secondary">
      You signed this place a moment ago. It is saved; this copy of the page was made before you
      signed it.
    </p>

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
      <!-- ⚠ A picture IS going on this line and this browser has not got it — it was staged on a
           previous visit and the bundle serves capture dates, never bytes (`markStaged`). So the
           screen says so, in a sentence. ⚠ **It must not fall through to the typed name below**: that
           preview would be of the wrong mark, shown with no caveat, which is precisely the failure
           C2 exists to close, arriving through the one door C2 itself opened for every driver. -->
      <p
        v-if="ceremony.currentShowsDrawing.value && !drawnUrl && ceremony.markCarriedOver.value"
        class="text-sm text-ink-secondary"
      >
        {{ copy.markCarriedOver }}
      </p>
      <img
        v-else-if="ceremony.currentShowsDrawing.value && drawnUrl"
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
/*
 * ⚠ **The TYPED-TEXT face, matching `StandardFonts.HelveticaOblique` — see `PacketAdoption.vue`'s
 * copy of this rule**, which carries the measurement that produced it.
 *
 * ⚠ **Duplicated rather than lifted, and that is a deliberate two-line copy rather than an oversight.**
 * `<style scoped>` cannot be shared between components, and the alternatives are worse than the
 * duplication: a global class puts a printing decision in the design system where `lint:tokens` owns
 * type, and a wrapper component adds a node to two screens to carry two declarations. ⚠ The pair must
 * move together — both are reached only when a mark falls back to `drawText`, and a screen showing
 * one face while its neighbour shows another is the disagreement this step exists to end.
 * ⚠ `SigningCeremony.vue` keeps the brush script on purpose: it is a different document, rendered by
 * pdfkit rather than by `packetOverlay`, and it makes no claim that its preview is the print.
 */
.signature-preview {
  font-family: Helvetica, Arial, "Liberation Sans", sans-serif;
  font-style: oblique 12deg;
}
</style>
