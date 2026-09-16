<script setup lang="ts">
import { BASEMAP_CHOICES, type BasemapChoice } from "@silvicom/shared";
import { AppIcon, AppButton as BaseButton } from "@silvicom/ui";
import { PlusIcon, MinusIcon } from "@silvicom/ui/icons";

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
 * ── WHY THE BASEMAP IS A SEGMENTED CONTROL AND NOT A DROPDOWN ────────────────────────────────────
 * Three options, all always available, one active — that is a radio group, and comp (7) draws it as
 * one. A dropdown would hide two of three choices behind a click to save 90px on a surface whose
 * whole point is that it is large.
 *
 * ⚠ There is no Day/Night button beside them, and that is D-DR8's ruling holding: the road map
 * follows the colour scheme the reader already chose, so a fourth button would put that answer on
 * screen twice and let the two disagree. `BASEMAP_CHOICES` deliberately does not contain `mapNight`.
 */
defineProps<{ basemap: BasemapChoice }>();
const emit = defineEmits<{ "update:basemap": [BasemapChoice]; zoom: [1 | -1] }>();
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

    <div
      role="radiogroup"
      aria-label="Basemap"
      class="flex overflow-hidden rounded-surface bg-surface shadow-card ring-1 ring-edge-subtle"
    >
      <BaseButton
        v-for="choice in BASEMAP_CHOICES"
        :key="choice.key"
        variant="ghost"
        size="sm"
        role="radio"
        :aria-checked="basemap === choice.key"
        :class="[
          'rounded-none text-xs',
          basemap === choice.key ? 'bg-brand-50 font-semibold text-brand-700' : 'text-ink-muted',
        ]"
        @click="emit('update:basemap', choice.key)"
      >
        {{ choice.label }}
      </BaseButton>
    </div>
  </div>
</template>
