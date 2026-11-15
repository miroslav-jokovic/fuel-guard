<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from "vue";
import { useRoute, useRouter } from "vue-router";
import { buildTrail } from "@/lib/breadcrumbs";
import { hasHeroPlate } from "@/lib/layout";
import BreadcrumbTrail from "@/components/ui/BreadcrumbTrail.vue";
import { useOpens } from "@/composables/useOpens";
import { AppButton as BaseButton, AppIcon, useTouchTargets } from "@silvicom/ui";
import { ChevronDownIcon } from "@silvicom/ui/icons";

const props = withDefaults(
  defineProps<{
    title?: string;
    description?: string;
  }>(),
  {
    title: undefined,
    description: undefined,
  },
);
const route = useRoute();

/**
 * ── `#more`: THE VERBS A PHONE FOLDS AWAY (SMALL-SCREENS-PLAN.md Q-SM4 (b), 2026-11-15) ───────────
 * Drivers carries four header buttons; at 390 px they took two lines above the title's own content,
 * and the owner's audit read that as deformed buttons. A page now says which of its verbs are
 * secondary by putting them in `#more` instead of `#actions`. In a header at least 56rem wide
 * nothing changes: the wrapper is `display: contents`, so they sit in the row before the page's
 * `#actions`, as they always did. In a narrower one they are behind one "More" button, and what
 * stays on the line is what the page left in `#actions` — its primary verb.
 *
 * ⚠ The ruler is the HEADER's width, not the window's (D-SM9's reason). The first build switched at
 * `md` and the browser pass showed what that left: at 768 px, and at 1024 with the sidebar open,
 * four buttons fit on one line by crushing the description into a column four words wide (header
 * 145 px tall for 85). The window never was the question — the sidebar takes 270 px of it.
 *
 * ⚠ The PAGE marks them; the header does not guess. Reading the slot for `variant="primary"` would
 * have needed no page to change, and would have been wrong on the first header whose main verb is
 * not drawn primary (Assets, Driver detail) or sits inside a wrapper component.
 *
 * ⚠ ONE DOM at every width, switched by container classes — the rule A2's filter sheet set, for its
 * reason: jsdom has no `matchMedia`, so a branch taken in script hands every page test the phone
 * header, with the buttons it presses inside a closed panel. Closed, the buttons are still in the
 * document where the desk has them.
 *
 * A disclosure, not an ARIA menu: what is inside are the page's own buttons and links, each still
 * its own tab stop, so the button says `aria-expanded` and nothing pretends to be a `menuitem`.
 */
const moreOpen = ref(false);
const moreId = useId();
const actionsRow = ref<HTMLElement | null>(null);
function onDocumentPointer(e: Event) {
  if (moreOpen.value && actionsRow.value && !actionsRow.value.contains(e.target as Node)) moreOpen.value = false;
}
function onDocumentKey(e: KeyboardEvent) {
  if (e.key !== "Escape" || !moreOpen.value) return;
  moreOpen.value = false;
  // Back to the button that opened it: the panel it was in is gone.
  actionsRow.value?.querySelector<HTMLElement>("[data-test='header-more']")?.focus();
}
onMounted(() => {
  document.addEventListener("pointerdown", onDocumentPointer);
  document.addEventListener("keydown", onDocumentKey);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocumentPointer);
  document.removeEventListener("keydown", onDocumentKey);
});
const router = useRouter();
/** Each crumb links only where the guard opens it (SP5); `BreadcrumbTrail` renders the rest as text. */
const opens = useOpens();
/** A touched shop page keeps the shell's Back and drops the trail (contract §9 rule 5). */
const touch = useTouchTargets();
const resolvedTitle = computed(() => props.title ?? (route.meta.title as string) ?? "Silvicom 360");

/**
 * Is this header standing on the page backdrop (D-DT18)?
 *
 * ⚠ Until 2026-09-20 the plate was this component's own `hero` prop, drawn as an `<img>` inside a
 * card band. D-DT15 took the card away and D-DT18 took the photograph away as well — a plate that
 * lives inside the header has to END where the header ends, and the only tool left for the ending
 * was a fade dissolving it into empty canvas a few pixels above the tab strip. That is a picture
 * that ran out. `AppShell` draws it as a page layer now, and all this header needs to know is that
 * something is behind it: a greeting standing on a photograph takes no bottom rule and no card.
 */
const onBackdrop = computed(() => hasHeroPlate(route));

/**
 * The breadcrumb trail (G2, UI-GAPS-PLAN.md), walked from `meta.parent` by `lib/breadcrumbs.ts`.
 *
 * ⚠ `router.resolve` never returns null — since G1 an unknown path matches the catch-all — so the
 * "does this route exist" question is answered by checking the resolved name, not by a null test.
 * A dead parent must truncate the trail rather than produce a crumb labelled "Page not found".
 *
 * `BreadcrumbTrail` decides whether a trail is worth rendering; this only decides what the trail is.
 */
const trail = computed(() =>
  buildTrail(route.path, (path) => {
    const resolved = router.resolve(path);
    return resolved.name === "not-found" ? null : resolved.meta;
  }),
);
</script>

<template>
  <header
    :class="[
      '@container',
      'flex flex-col gap-4 sm:flex-row sm:justify-between',
      /*
       * The actions sit at the TOP of a hero band and at the BOTTOM of a plain header.
       * Measured at 1280px: bottom-aligned, they landed squarely on the truck's cab — the busiest,
       * highest-contrast corner of every plate — because the cab is bottom-right and so were they.
       * The sky is the quiet part of the frame, and the comps put the date range and Export up
       * there for the same reason. The plain header keeps `items-end`, where actions should line up
       * with the baseline of the title rather than float above it.
       */
      onBackdrop ? 'sm:items-start' : 'sm:items-end',
      /*
       * ⚠ No surface, no ring, no elevation, and no bottom rule (D-DT15/D-DT18). A card made a
       * photograph look like a widget and put a border around the one element on the page that is
       * not a control; the rule below it would now be a line drawn across the middle of a
       * photograph. The height is the band's own — 136px, the prototype's — so the greeting sits
       * level with the subject rather than above it.
       */
      onBackdrop ? 'page-header-on-plate relative justify-center py-2' : 'border-b border-edge-subtle pb-5',
    ]"
  >
    <div class="min-w-0">
      <BreadcrumbTrail :trail="trail" :opens="opens" :hide-on-touch="touch" />
      <!--
        One step up on a plate (D-DT22): a 24px greeting beside a photograph ~100px tall read as a
        caption to the picture rather than the page's title — the image out-weighed the words it was
        there to frame. The plain header keeps 2xl, where it is the largest thing on the page anyway.
      -->
      <h1
        :class="[
          'font-semibold tracking-tight text-ink',
          onBackdrop ? 'text-3xl text-balance' : 'text-2xl',
        ]"
      >
        {{ resolvedTitle }}
      </h1>
      <p v-if="description || $slots.default" class="mt-1 max-w-3xl text-sm text-ink-tertiary">
        <slot>{{ description }}</slot>
      </p>
      <div v-if="$slots.freshness" class="mt-2 text-xs text-ink-tertiary">
        <slot name="freshness" />
      </div>
    </div>
    <!-- `relative` is for the phone's More panel, which opens under the whole row (see `#more` above). -->
    <div v-if="$slots.actions || $slots.more" ref="actionsRow" class="relative flex shrink-0 flex-wrap items-center gap-2">
      <template v-if="$slots.more">
        <BaseButton
          class="@max-4xl:order-last @4xl:hidden"
          :aria-expanded="moreOpen"
          :aria-controls="moreId"
          data-test="header-more"
          @click="moreOpen = !moreOpen"
        >
          More <AppIcon :icon="ChevronDownIcon" class="-mr-0.5 size-4" aria-hidden="true" />
        </BaseButton>
        <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/no-static-element-interactions -- not a control: it only closes the panel after one of the buttons inside it has been used, and each of those is its own keyboard target -->
        <div
          :id="moreId"
          class="@4xl:contents"
          :class="moreOpen
            ? '@max-4xl:absolute @max-4xl:inset-x-0 @max-4xl:sm:left-auto @max-4xl:sm:w-64 @max-4xl:top-full @max-4xl:z-popover @max-4xl:mt-2 @max-4xl:flex @max-4xl:flex-col @max-4xl:gap-1 @max-4xl:rounded-control @max-4xl:bg-surface @max-4xl:p-2 @max-4xl:shadow-dialog @max-4xl:ring-1 @max-4xl:ring-edge @max-4xl:[&>*]:w-full @max-4xl:[&>*]:justify-start'
            : '@max-4xl:hidden'"
          data-test="header-more-panel"
          @click="moreOpen = false"
        >
          <slot name="more" />
        </div>
      </template>
      <slot name="actions" />
    </div>
  </header>
</template>
