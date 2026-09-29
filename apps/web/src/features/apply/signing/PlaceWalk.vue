<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import SigningPageView from "@/features/apply/signing/SigningPageView.vue";
import SigningPlaceRail from "@/features/apply/signing/SigningPlaceRail.vue";
import type { LocatedPlaces, RailPlace } from "@/features/apply/signing/signingPlaces";

/**
 * One place at a time, on the page it is on — the one walk the packet AND the handbook are signed with
 * (D-HB12, owner 2026-09-29: *"this has to be standardized, we need this to be same on Application and
 * Handbook"*).
 *
 * ── WHAT IS THE SAME ON BOTH, AND LIVES HERE ─────────────────────────────────────────────────
 * The page the place is on, opened for the driver; the **Sign here** tag on the place's own box (the
 * permissions' act, over the `sign:<id>` destination the renderer wrote); the rail of places; reading
 * another page and "Take me back"; and WHEN the document is fetched again. What differs stays with the
 * caller, in the default slot: the packet's two adopted marks and initials, the handbook's server-
 * applied signature, their sentences and their refusals.
 *
 * ── ⚠ WHEN THE DOCUMENT IS FETCHED AGAIN (decision A, as measured) ───────────────────────────
 * The owner ruled that the page redraws with the signature on it. The packet's reading copy measured
 * **635 KB** (the carrier's embedded fonts; the handbook is 61 KB), so fetching it after every one of
 * ~15 places would move ~10 MB over a phone for pages the driver has already left. So the rule is:
 * **fetch again when the page ON SCREEN holds a place signed since the copy was fetched.** That is the
 * next place on the same sheet (p11a → p11b, p31a → p31b), or the driver looking back — every time a
 * signature could be seen, and no other time. `?v=` is the number of places the copy carries, so the
 * address says what it holds.
 *
 * ⚠ **Nothing here decides where the driver is SIGNING.** `currentId` is the caller's derived answer
 * (the first place nobody has signed — [[a-cursor-into-a-refetched-list-strands-the-walk]]); this
 * only holds which page is being READ, as a departure that clears the moment the signing place moves.
 */
const props = defineProps<{
  /** The document, without a version. */
  src: string;
  label: string;
  places: readonly RailPlace[];
  /** What the rail counts — "on the application", "in the handbook". */
  scope: string;
  currentId: string | null;
  signedIds: ReadonlySet<string>;
  /** The tag's words: "Sign here", "Initial here". */
  tagLabel: string;
  workingLabel: string;
  working: boolean;
}>();
const emit = defineEmits<{ sign: []; failed: [] }>();

const located = ref<LocatedPlaces>({});
const viewer = ref<"loading" | "ready" | "failed">("loading");

/** The page a place is on: the document's answer, else the paper's, else the first. */
const pageOf = (id: string | null | undefined): number => {
  if (!id) return 1;
  return located.value[id]?.page ?? props.places.find((p) => p.id === id)?.page ?? 1;
};

const lookingOverride = ref<string | null>(null);
const lookingId = computed(() =>
  lookingOverride.value && props.places.some((p) => p.id === lookingOverride.value) ? lookingOverride.value : props.currentId,
);
watch(() => props.currentId, () => (lookingOverride.value = null));
const lookingAway = computed(() => Boolean(props.currentId) && lookingId.value !== props.currentId);
const page = computed(() => pageOf(lookingId.value));

// ── when the copy is fetched again ─────────────────────────────────────────────────────────────
const fetchedWith = ref<ReadonlySet<string>>(new Set(props.signedIds));
watch(
  [page, () => props.signedIds, located],
  () => {
    const stale = props.places.some(
      (p) => pageOf(p.id) === page.value && props.signedIds.has(p.id) && !fetchedWith.value.has(p.id),
    );
    if (stale) fetchedWith.value = new Set(props.signedIds);
  },
);
const versionedSrc = computed(() => `${props.src}${props.src.includes("?") ? "&" : "?"}v=${fetchedWith.value.size}`);
watch(versionedSrc, () => (viewer.value = "loading"));

/** The rail with each place's page as the document placed it — the handbook's are only known there. */
const railPlaces = computed<RailPlace[]>(() => props.places.map((p) => ({ ...p, page: located.value[p.id]?.page ?? p.page })));

/**
 * The plain Sign button, for when there is no tag to press: the document did not load, or does not
 * name this place. ⚠ Never while loading, when the tag is about to appear — two buttons for one act
 * would be offered for the half-second between them.
 */
const needsButton = computed(
  () => Boolean(props.currentId) && viewer.value !== "loading" && !(props.currentId! in located.value),
);

function onLocated(places: LocatedPlaces): void {
  located.value = places;
}
</script>

<template>
  <section class="space-y-4">
    <slot name="header" :page="pageOf(currentId)" />

    <!-- ⚠ The page and the sentence, BOTH, at every width (D-HUI9): at 390 px the page is a shape that
         says where on the paper the driver is, and the sentence below carries the words. -->
    <div class="lg:flex lg:items-start lg:gap-x-6">
      <div class="lg:order-2 lg:min-w-0 lg:flex-1">
        <SigningPageView
          :src="versionedSrc"
          :page="page"
          :label="`${label}, page ${page}`"
          :places="places.map((p) => p.id)"
          :tag-place-id="lookingAway ? null : currentId"
          @located="onLocated"
          @loaded="viewer = 'ready'"
          @failed="viewer = 'failed'; emit('failed')"
        >
          <template #tag>
            <BaseButton variant="primary" size="sm" class="sign-here-tag" :disabled="working" @click="emit('sign')">
              {{ working ? workingLabel : tagLabel }}
            </BaseButton>
          </template>
        </SigningPageView>
      </div>
      <!-- A strip of dots above the page on a phone, a column of places beside it with room (decision C). -->
      <div class="mt-4 lg:order-1 lg:mt-0 lg:w-44 lg:shrink-0">
        <SigningPlaceRail
          :stops="railPlaces"
          :scope="scope"
          :current-id="currentId"
          :looking-id="lookingId"
          :signed-ids="signedIds"
          @look="lookingOverride = $event"
        />
      </div>
    </div>

    <!-- The driver has wandered off the place being signed: said plainly, with the way back. -->
    <p v-if="lookingAway" class="text-sm text-ink-secondary">
      You are reading page {{ page }}. The place you are signing is on page {{ pageOf(currentId) }}.
      <BaseButton variant="ghost" size="sm" @click="lookingOverride = null">Take me back</BaseButton>
    </p>

    <slot />

    <div v-if="needsButton" class="flex justify-end">
      <BaseButton variant="primary" :disabled="working" @click="emit('sign')">
        {{ working ? workingLabel : tagLabel }}
      </BaseButton>
    </div>
  </section>
</template>

<style scoped>
/* The tag sits on the box, like DocuSign's and like the permissions' (`SigningCeremony.vue`). */
.sign-here-tag {
  margin-top: 0.15rem;
}
</style>
