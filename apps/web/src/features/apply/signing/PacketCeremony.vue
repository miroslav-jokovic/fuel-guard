<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import type { SignatureAdoptionsView } from "@silvicom/shared";
import type { ApplyPacketStop } from "@/features/apply/useApplication";
import { usePacketCeremony } from "@/features/apply/signing/usePacketCeremony";
import PacketAdoption from "@/features/apply/signing/PacketAdoption.vue";
import PlaceWalk from "@/features/apply/signing/PlaceWalk.vue";
import { APPLY_COPY } from "@/features/apply/strings";
import { envelopePlaces } from "@/features/apply/signing/envelope";

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
 * ── PROGRESS COUNTS THE ENVELOPE, NOT THE WORK LEFT ───────────────────────────────────────────
 * "Place 7 of 19" counts against the whole envelope, including stops a previous session collected.
 * Counting only what is outstanding would renumber the stops under a driver who came back — their
 * fourth place would be called the first — and the number somebody is watching must not move. Since
 * C3s4b the "of" includes the handbook's five places that follow the filing (D-AW16, `envelope.ts`), so
 * the last packet place is not announced as the end.
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
  /**
   * Whether an INITIALS picture was staged on a previous visit (Q-HUI14).
   *
   * ⚠ A second prop rather than one flag for both, because they are two `application_captures` rows
   * and a driver can genuinely have one without the other — a walk resumed after the signature was
   * adopted but before the first initials stop is exactly that. Derived in `SignOffScreen` beside its
   * sibling, for the same reason that one is.
   */
  initialsStaged?: boolean;
  /** Screen 13's adoptions (D-AW15, C3s2a): offered as "This is your signature — use it". */
  adoptions?: SignatureAdoptionsView;
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
    initialsStaged: computed(() => Boolean(props.initialsStaged)),
    adoptions: computed(() => props.adoptions),
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
/**
 * And the INITIALS picture's URL (Q-HUI14).
 *
 * ⚠ A second URL rather than one that follows the current stop's mark, and that is not a shortcut:
 * the confirm screen shows both pictures at once, so a single URL could never serve it. One blob, one
 * URL, one revoke — twice.
 */
const initialsUrl = ref<string | null>(null);

/**
 * ⚠ One watcher per picture, and the bodies are identical on purpose — the alternative is a watcher
 * on both blobs at once, which cannot tell which of the two changed and so must revoke and re-create
 * both URLs on every keystroke in either field.
 */
function followBlob(blob: Blob | null, url: typeof drawnUrl): void {
  if (url.value) URL.revokeObjectURL(url.value);
  url.value = blob ? URL.createObjectURL(blob) : null;
}
watch(() => ceremony.markBlob.value, (blob) => followBlob(blob, drawnUrl), { immediate: true });
watch(
  () => ceremony.initialsBlob.value,
  (blob) => followBlob(blob, initialsUrl),
  { immediate: true },
);
onBeforeUnmount(() => {
  if (drawnUrl.value) URL.revokeObjectURL(drawnUrl.value);
  if (initialsUrl.value) URL.revokeObjectURL(initialsUrl.value);
});

/**
 * The picture for the stop the driver is standing on (Q-HUI14).
 *
 * ⚠ **Selected by the stop's own `mark`, never by its page number** — the same rule
 * `renderPacketOverlay`'s mark loop and `currentShowsDrawing` follow, and the reason the three agree
 * is that all three read `PacketPlacement.mark` rather than remembering which pages ask for what.
 * Showing `drawnUrl` at an initials stop would be A3's defect rendered on the screen instead of on
 * the paper: the driver told their signature was about to go in a box captioned `Initials`.
 */
const currentMarkUrl = computed(() =>
  ceremony.current.value?.mark === "initials" ? initialsUrl.value : drawnUrl.value,
);

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
 * The page, the Sign here tag, the rail and "Take me back" are `PlaceWalk`'s since D-HB12 (2026-09-29):
 * the handbook is walked by the same component, so the two cannot drift apart again. What stays here is
 * what only the packet has — two adopted marks, initials, and correcting a mark before it is pinned.
 *
 * ⚠ The reading copy is fetched again only when the page on screen holds a place signed since it was
 * fetched (`PlaceWalk` has the 635 KB measurement behind that rule), so the old sentence *"this copy of
 * the page was made before you signed it"* is gone: the page on screen now always carries what is signed.
 */
const packetSrc = computed(() => `/api/public/application/${encodeURIComponent(props.token)}/packet`);

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
    :initials-url="initialsUrl"
    @done="emit('done', $event)"
  />

  <!-- One place, on the page it is on, with the Sign here tag on its line (C1, D-HB12). -->
  <PlaceWalk
    v-else-if="ceremony.current.value"
    :src="packetSrc"
    label="The carrier's application"
    :places="stops"
    scope="on the application"
    :current-id="ceremony.current.value.id"
    :signed-ids="ceremony.signedHere.value"
    :tag-label="ceremony.current.value.mark === 'initials' ? copy.initialAction : copy.signAction"
    :working-label="copy.working"
    :working="ceremony.working.value"
    @sign="signCurrent"
  >
    <template #header>
      <div class="flex items-baseline justify-between gap-4">
        <span class="text-xs font-medium text-ink-tertiary">
          {{ copy.page(ceremony.current.value.page) }}
        </span>
        <span class="text-xs text-ink-muted">
          {{ copy.counter(ceremony.position.value, envelopePlaces(ceremony.total.value)) }}
        </span>
      </div>
    </template>

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
      <!-- ⚠ All three reads are now per-STOP (Q-HUI14): `currentShowsDrawing` and
           `currentMarkCarriedOver` select on the stop's mark in the composable, and `currentMarkUrl`
           does the same for the bytes. Reading `markCarriedOver` and `drawnUrl` directly, as this did
           before the initials had a picture, would have said *"your signature picture is saved"* while
           standing on `p05`. -->
      <p
        v-if="
          ceremony.currentShowsDrawing.value
            && !currentMarkUrl
            && ceremony.currentMarkCarriedOver.value
        "
        class="text-sm text-ink-secondary"
      >
        {{
          ceremony.current.value?.mark === "initials"
            ? copy.initialsCarriedOver
            : copy.markCarriedOver
        }}
      </p>
      <img
        v-else-if="ceremony.currentShowsDrawing.value && currentMarkUrl"
        :src="currentMarkUrl"
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

    <!-- ⚠ The picture did not save (A3). Said at every remaining stop rather than once, because a
         driver who missed one notice would otherwise sign the rest of the packet still believing
         their mark was on it. It is not an error state: nothing is lost and the walk continues.
         ⚠ Both marks, each with its own sentence and its own condition (Q-HUI14) — one can land while
         the other fails, and telling a driver their signature did not save when it did would be worse
         than saying nothing. The initials notice is withheld once no page asks for them. -->
    <p v-if="ceremony.drawnMarkFailed.value" class="text-sm text-ink-secondary">
      {{ copy.drawFailed }}
    </p>
    <p
      v-if="ceremony.needsInitials.value && ceremony.initialsMarkFailed.value"
      class="text-sm text-ink-secondary"
    >
      {{ copy.initialsFailed }}
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

  </PlaceWalk>

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
 * ⚠ Since Q-HUI14 *"falls back to `drawText`"* is the WHOLE of what reaches this face: the three
 * initials lines used to reach it by rule and now print a picture like every other line, so a mark
 * shown in this face is a mark whose staging failed and nothing else.
 * ⚠ `SigningCeremony.vue` keeps the brush script on purpose: it is a different document, rendered by
 * pdfkit rather than by `packetOverlay`, and it makes no claim that its preview is the print.
 */
.signature-preview {
  font-family: Helvetica, Arial, "Liberation Sans", sans-serif;
  font-style: oblique 12deg;
}
</style>
