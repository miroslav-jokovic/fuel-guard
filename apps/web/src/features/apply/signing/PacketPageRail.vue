<script setup lang="ts">
import { computed } from "vue";
import type { ApplyPacketStop } from "@/features/apply/useApplication";

/**
 * The twenty-two places, as a rail beside the page (C1).
 *
 * ── ⚠ IT IS NOT A CURSOR, AND THAT IS THE WHOLE CARE OF THIS FILE ─────────────────────────────
 * `usePacketCeremony.current` is DERIVED — it is the first stop nobody has filed — and A4 fixed a
 * defect where a `refetchOnWindowFocus` refetch stranded a walk past the 11th mark because the
 * position had been stored instead. The handoff's warning for C1 is that a page index is the same
 * shape one level up.
 *
 * So this rail moves nothing. It emits `look`, which changes **which page is being READ**, and the
 * parent clears that the moment the signing position moves. Where the driver is SIGNING stays the
 * composable's answer and nothing here can write it. The two are different questions and the
 * component that shows both must not blur them: a stop is `signed`, `signing` (exactly one, and it
 * is `current`), or `waiting`, and separately it may be the one being `looked` at.
 *
 * ── AND WHY LOOKING AHEAD IS ALLOWED AT ALL ───────────────────────────────────────────────────
 * Reading is not signing (D-HUI12), and C1 exists so that a driver can read what they are agreeing
 * to. A rail that refused to show page 20 until page 19 was signed would be the pressure this step
 * removes, dressed as safety. The Sign button is always for `current` and says so.
 *
 * ── PROGRESS COUNTS THE PACKET, NOT THE WORK LEFT ─────────────────────────────────────────────
 * The numbering is the position in the carrier's own order, so a driver who comes back sees their
 * fourth place still called the fourth. Renumbering under a returning driver is the failure the
 * ceremony's own comment exists to prevent.
 */
const props = defineProps<{
  stops: ApplyPacketStop[];
  /** The stop being SIGNED — the composable's derived answer. Null once every place is collected. */
  currentId: string | null;
  /** The stop being READ. Usually the same; different only while the driver looks around. */
  lookingId: string | null;
  /**
   * Every stop that is DONE — `usePacketCeremony.signedHere`, which counts the marks filed in this
   * tab as well as the ones the server already had.
   *
   * ⚠ `stop.signedAt` alone is NOT this question, and using it was a defect the browser caught: the
   * bundle is not refetched per mark, so after signing two places the rail still read *"0 of 22
   * done"* while the driver watched. The page underneath legitimately lags — it is fetched once per
   * ceremony — but the COUNT must not.
   */
  signedIds: ReadonlySet<string>;
}>();
const emit = defineEmits<{ look: [stopId: string] }>();

type RailStop = {
  stop: ApplyPacketStop;
  index: number;
  signed: boolean;
  signing: boolean;
  looking: boolean;
};

/**
 * ⚠ Keyed on `stop.id`, never on array position. Page 19 carries two driver lines identical in every
 * other field, and `id` is written out rather than derived from order for exactly that reason — an
 * index would silently re-point a signature if the packet ever gained a placement mid-array, which
 * it has done before (p17, D-PKT12).
 */
const rail = computed<RailStop[]>(() =>
  props.stops.map((stop, i) => ({
    stop,
    index: i + 1,
    signed: props.signedIds.has(stop.id),
    signing: stop.id === props.currentId,
    looking: stop.id === props.lookingId,
  })),
);

const signedCount = computed(() => rail.value.filter((r) => r.signed).length);

function dotClass(r: RailStop): string {
  if (r.signed) return "bg-action-primary";
  if (r.signing) return "bg-action-primary/40 ring-2 ring-action-primary";
  return "bg-surface-muted ring-1 ring-edge";
}
</script>

<template>
  <nav class="w-full" :aria-label="`The ${stops.length} places you are asked to sign`">
    <p class="mb-2 text-xs text-ink-muted">
      {{ signedCount }} of {{ stops.length }} done
    </p>

    <!--
      ⚠ A WRAPPING strip on a phone that becomes a column with room, rather than two components.
      The phone needs its vertical space for the page itself (D-HUI9: at 390px the page is a shape
      and the sentence carries the words), so the rail must stay short — but it must not scroll
      sideways either.

      ⚠ **It was `overflow-x-auto`, and that scrolled the whole PAGE.** Measured at a true 390px
      viewport: `document.documentElement.scrollWidth` came back 1011 against a 390 viewport and
      `window.scrollTo(500, 0)` moved — so the driver could drag the entire signing screen off to
      one side. The strip itself clipped correctly and every box in the chain measured 302px, which
      is why it is worth writing down what did and did not fix it: `overflow: hidden` on the list,
      on the nav, and on the section all left it at 1011; `contain: paint` and `flex-wrap` both
      collapsed it to 390. Wrapping wins because it needs no exotic property and it shows all
      twenty-two places at once, which a seven-wide scroller never did.
    -->
    <ol class="flex flex-wrap gap-1 lg:flex-col lg:flex-nowrap lg:gap-0.5">
      <li v-for="r in rail" :key="r.stop.id" class="shrink-0 lg:w-full">
        <button
          type="button"
          class="flex w-full items-center gap-x-1.5 rounded-control px-1.5 py-1 text-left transition-colors hover:bg-surface-muted lg:gap-x-2 lg:px-2 lg:py-1.5"
          :class="r.looking ? 'bg-surface-muted' : ''"
          :aria-current="r.looking ? 'true' : undefined"
          @click="emit('look', r.stop.id)"
        >
          <span class="size-2 shrink-0 rounded-full" :class="dotClass(r)" aria-hidden="true" />
          <span class="text-2xs font-medium text-ink-tertiary lg:text-xs">
            {{ r.index }}
          </span>
          <!-- The carrier's own page number, hidden on the phone strip where there is no room for
               it and the dot plus the number already say where you are. -->
          <span class="hidden truncate text-xs text-ink-muted lg:inline">
            Page {{ r.stop.page }}
          </span>
          <span class="sr-only">
            {{ r.stop.what }} —
            {{ r.signed ? "signed" : r.signing ? "the place you are signing now" : "still to come" }}
          </span>
        </button>
      </li>
    </ol>
  </nav>
</template>
