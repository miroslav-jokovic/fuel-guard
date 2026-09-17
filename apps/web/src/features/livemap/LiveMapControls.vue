<script setup lang="ts">
import { computed } from "vue";
import { BASEMAP_CHOICES, type BasemapChoice } from "@silvicom/shared";
import { AppIcon, AppButton as BaseButton } from "@silvicom/ui";
import { PlusIcon, MinusIcon, MapIcon } from "@silvicom/ui/icons";
import KebabMenu from "@/components/KebabMenu.vue";

/**
 * The map's own control rail — zoom, and which basemap is underneath (D-DR20/D-DR21).
 *
 * ── WHY WE DRAW THESE AND MAPLIBRE NO LONGER DOES ────────────────────────────────────────────────
 * maplibre places a control in one of FOUR corners, and on this workspace all four are spoken for:
 * fleet status top-left, filters top-right, the truck card bottom-left, HERE's attribution
 * bottom-right. Its zoom buttons went to `top-right` and sat UNDER the filters panel — measured at
 * 27×56px of overlap, identically at 1512, 1280, 1024 and 768, because both are pinned to the same
 * edge with fixed insets. There is no corner left to move it to, so the rail is ours and sits
 * BELOW the top-right panel rather than in its corner.
 *
 * ⚠ The rail is `pointer-events-auto` inside a `pointer-events-none` layer, like every other panel
 * here. Getting that backwards makes the whole map undraggable, which looks like a broken map rather
 * than a misplaced class.
 *
 * ── THE BASEMAP OPENS FROM A BUTTON (D-LM22, the owner's item 5) ─────────────────────────────────
 * ⚠ THIS OVERRULES THIS FILE'S OWN EARLIER REASONING, which is recorded here rather than deleted so
 * the next reader knows it was weighed and not missed. It argued: "three options, all always
 * available, one active — that is a radio group, and comp (7) draws it as one. A dropdown would hide
 * two of three choices behind a click to save 90px on a surface whose whole point is that it is
 * large." The 90px was the wrong quantity. The three segments are a permanently-lit row of chrome on
 * a canvas that IS the product, and the owner reads them as clutter — a basemap is chosen rarely and
 * then left alone for the rest of a shift, so a control sized for a once-a-day decision was sitting
 * at full size all day. The button still NAMES the active basemap, so nothing is hidden that the row
 * was telling anybody: a reader learns which basemap they are on without opening it.
 *
 * ⚠ It is `KebabMenu` with a `#trigger`, not a new dropdown. That primitive is this repo's one menu,
 * it teleports its panel to `body` through floating-ui — which matters here, because a panel rendered
 * inside the map container would be clipped by the canvas's `overflow-hidden` — and `lint:ui-adoption`
 * counts a raw `<button>` in a feature as a failure. A local clone would have been all three mistakes.
 *
 * ⚠ There is STILL no Day/Night entry, and that is D-DR8's ruling holding whatever the control looks
 * like: the road map follows the colour scheme the reader already chose, so a fourth entry would put
 * that answer on screen twice and let the two disagree. `BASEMAP_CHOICES` deliberately does not
 * contain `mapNight`, and this control renders that catalogue rather than a list of its own.
 */
const props = defineProps<{ basemap: BasemapChoice }>();
const emit = defineEmits<{ "update:basemap": [BasemapChoice]; zoom: [1 | -1] }>();

/**
 * ⚠ Read from `BASEMAP_CHOICES` rather than kept as a second label map beside it. The catalogue is
 * shared with the API's allowlist, and a copy here would be a copy with a delay fuse — the trigger
 * would go on saying "Terrain" the day the catalogue renamed it.
 */
const activeLabel = computed(
  () => BASEMAP_CHOICES.find((c) => c.key === props.basemap)?.label ?? BASEMAP_CHOICES[0]!.label,
);
</script>

<template>
  <div class="pointer-events-auto flex flex-col items-end gap-2">
    <!--
      Zoom, in the shared button primitive rather than a raw <button> — `lint:ui-adoption` counts
      every raw one in features with zero tolerance, and a control rail is not an exception to the
      design system just because maplibre used to draw it.
    -->
    <div class="flex flex-col overflow-hidden rounded-surface shadow-card ring-1 ring-edge-subtle">
      <BaseButton variant="ghost" size="sm" aria-label="Zoom in" class="rounded-none bg-surface" @click="emit('zoom', 1)">
        <AppIcon :icon="PlusIcon" class="size-4" aria-hidden="true" />
      </BaseButton>
      <BaseButton
        variant="ghost"
        size="sm"
        aria-label="Zoom out"
        class="rounded-none border-t border-edge-subtle bg-surface"
        @click="emit('zoom', -1)"
      >
        <AppIcon :icon="MinusIcon" class="size-4" aria-hidden="true" />
      </BaseButton>
    </div>

    <!--
      ⚠ `placement="left-start"` because this rail is pinned to the RIGHT edge of the map. The
      primitive's `bottom-end` default would open a 12rem panel off the side of the canvas;
      floating-ui's `shift` would drag it back, but then it covers the button that opened it.
    -->
    <KebabMenu placement="left-start" :trigger-label="`Basemap: ${activeLabel}`">
      <template #trigger>
        <span
          class="flex items-center gap-1.5 rounded-surface bg-surface px-2.5 py-1.5 text-xs text-ink-secondary shadow-card ring-1 ring-edge-subtle"
        >
          <AppIcon :icon="MapIcon" class="size-4 text-ink-tertiary" aria-hidden="true" />
          {{ activeLabel }}
        </span>
      </template>
      <!--
        ⚠ A LABEL AND `aria-current`, AND NO VISUAL MARK INSIDE THE PANEL — a refusal, not a plainer
        first draft, and it cost two attempts to establish rather than one guess.

        A tick went in first. None of the nine other `kebab-item` call sites in this app has ever held
        an icon, and the reason showed up immediately: `.kebab-item`'s `text-left` lives in
        `@layer components` and loses to `AppButton`'s own `justify-center`, so the tick centred its
        own row and left the other two labels on a different edge (seen, 2026-09-17).

        A brand tint on the active entry went in second — `bg-brand-50 font-semibold text-brand-700`,
        the exact tokens the segmented control had used. It did NOTHING, and it did nothing silently:
        read back from the rendered DOM, all three entries measured `background-color: oklch(1 0 0)`,
        one colour and `font-weight: 600`. A call-site utility and the button's own utility sit in the
        SAME cascade layer, so which one wins is decided by Tailwind's own ordering rather than by the
        class attribute — which is the whole reason this file's neighbour says three times that an
        override at a call site means a variant is missing.

        So the panel does not mark the active entry, and it does not need to: the TRIGGER four pixels
        away names it, which is the same fact the segmented row used to carry. `aria-current` gives a
        screen reader the answer the trigger gives everybody else. Marking it visually is a change to
        `AppButton`, and that is a separate step with its own blast radius, not something to smuggle
        in under a basemap control.
      -->
      <BaseButton
        v-for="choice in BASEMAP_CHOICES"
        :key="choice.key"
        class="kebab-item"
        :aria-current="basemap === choice.key ? 'true' : undefined"
        @click="emit('update:basemap', choice.key)"
      >
        {{ choice.label }}
      </BaseButton>
    </KebabMenu>
  </div>
</template>
