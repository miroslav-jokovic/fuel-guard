<script setup lang="ts">
import { computed } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
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
 * ── ⚠ IT NAVIGATES ON A DESKTOP AND INDICATES ON A PHONE, AND THAT IS NOT A CLIMBDOWN ─────────
 * Two facts decided this and they point the same way. **D-HUI9**: at 390px the packet page is a
 * SHAPE and the sentence beside it carries the words, so the page needs every vertical pixel — a
 * rail of twenty-two rows above it would push the document off the screen it exists to show.
 * **The primitive**: `AppButton`'s `size="row"` is this repo's sanctioned left-aligned full-width
 * row, and its own header records that a call site reaching for `!important` means a variant is
 * missing rather than a rule being wrong. Twenty-two of those rows is ~880px on a phone.
 *
 * So below `lg` this is a progress INDICATOR — the count, and twenty-two dots saying what is done —
 * and at `lg` it is the column of real buttons it looks like. ⚠ The first version made the phone
 * strip tappable with a raw `<button>` inside a horizontal scroller, and **both halves were wrong**:
 * the raw button failed `lint:ui-adoption` (a CI gate that is not in `pnpm lint`), and the scroller
 * made the whole signing screen drag sideways — `documentElement.scrollWidth` measured **1011**
 * against a 390 viewport, and `overflow: hidden` on the list, the nav and the section all failed to
 * contain it.
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

/** What a screen reader is told about each place, on either layout. */
function stopLabel(r: RailStop): string {
  const state = r.signed
    ? "signed"
    : r.signing
      ? "the place you are signing now"
      : "still to come";
  return `Place ${r.index}, page ${r.stop.page}. ${r.stop.what} — ${state}`;
}
</script>

<template>
  <div class="w-full">
    <p class="mb-2 text-xs text-ink-muted">{{ signedCount }} of {{ stops.length }} done</p>

    <!-- The phone: an indicator, not a menu. Wrapped rather than scrolled — see the header. -->
    <ul
      class="flex flex-wrap gap-1.5 lg:hidden"
      :aria-label="`Progress through ${stops.length} places`"
    >
      <li v-for="r in rail" :key="r.stop.id">
        <span class="block size-2.5 rounded-full" :class="dotClass(r)" />
        <span class="sr-only">{{ stopLabel(r) }}</span>
      </li>
    </ul>

    <!-- The desktop: the column of places, each one a real button to the page it sits on. -->
    <nav
      class="hidden lg:block"
      :aria-label="`The ${stops.length} places you are asked to sign`"
    >
      <ol class="flex flex-col gap-0.5">
        <li v-for="r in rail" :key="r.stop.id">
          <BaseButton
            variant="ghost"
            size="row"
            :class="r.looking ? 'bg-surface-muted' : ''"
            :aria-current="r.looking ? 'true' : undefined"
            @click="emit('look', r.stop.id)"
          >
            <span class="size-2 shrink-0 rounded-full" :class="dotClass(r)" aria-hidden="true" />
            <span class="text-xs font-medium text-ink-tertiary">{{ r.index }}</span>
            <span class="truncate text-xs text-ink-muted">Page {{ r.stop.page }}</span>
            <span class="sr-only">{{ stopLabel(r) }}</span>
          </BaseButton>
        </li>
      </ol>
    </nav>
  </div>
</template>
