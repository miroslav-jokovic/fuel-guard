<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import {
  MARK_STYLES,
  loadSignatureFaces,
  markStyleById,
  renderStyledMark,
} from "@/features/apply/signing/markStyles";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * **Choose a style** — the first of C2's three tabs, and DocuSign's own first tab.
 *
 * The driver's own name, shown in four hands, and the one they pick is rasterised to the PNG the
 * carrier's packet prints (D-HUI14; the argument is in `markRaster.ts`).
 *
 * ⚠ **The options are rendered as CSS TEXT and the preview below them is the actual PNG**, and the
 * split is deliberate rather than an inconsistency. Rasterising four canvases on every keystroke is
 * work nobody sees — the options only have to answer *which of these hands do I want*, and they answer
 * it with the same font file, the same glyph outlines and the same rasteriser the canvas will use, so
 * what the driver compares is exactly what they would compare in pixels. The one that has to be
 * literally the filed bytes is the one they are about to approve, and that one is.
 *
 * ⚠ **`name` is passed in rather than read from the ceremony.** This component chooses a face; the name
 * belongs to the adoption form above it, which is also the thing that disables its own field once the
 * server has pinned the signature (A4). A second reader of `adoptedName` here would be a second place
 * the rule about when a name may change would have to live.
 */
const props = defineProps<{
  /** The typed name, live. Empty until the driver has typed something worth drawing. */
  name: string;
  /** The chosen face's id. */
  modelValue: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [id: string];
  /**
   * The PNG, or null when it could not be made.
   *
   * ⚠ Null is emitted rather than swallowed, for `SignaturePad`'s reason: the parent holds the current
   * mark and a stale blob left behind by a failed re-render would be staged in place of the one the
   * driver is looking at.
   */
  change: [Blob | null];
}>();

const copy = APPLY_COPY.packet;

/**
 * The rendered mark, for the preview directly under the picker.
 *
 * ⚠ **An object URL, revoked before the next one is made and again on unmount.** Each render is a
 * few tens of KB and a driver trying four faces against a name they are still typing makes a lot of
 * them; an unrevoked URL pins its blob for the life of the document.
 */
const previewUrl = ref<string | null>(null);

function show(blob: Blob | null): void {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = blob ? URL.createObjectURL(blob) : null;
}

/**
 * ⚠ **The last render wins, and the guard is a token rather than a cancellation.** `renderStyledMark`
 * awaits a font load and a `toBlob`, so two renders started a keystroke apart can finish in either
 * order — and the one that finishes second is the one the parent would stage. C1 met the same shape in
 * the packet viewer, where two overlapping pdfjs renders painted over each other. Here the prize is
 * worse than a flicker: the driver would approve a preview of one name and file a picture of another.
 */
let latest = 0;

async function render(): Promise<void> {
  const ticket = (latest += 1);
  const name = props.name.trim();
  if (!name) {
    if (ticket === latest) {
      show(null);
      emit("change", null);
    }
    return;
  }
  const blob = await renderStyledMark(name, markStyleById(props.modelValue));
  if (ticket !== latest) return;
  show(blob);
  emit("change", blob);
}

/**
 * ⚠ `immediate` — the mark for the default face has to exist before the driver presses anything.
 * Without it a driver who typed their name, glanced at the preview and pressed straight through would
 * adopt with no PNG staged, and `drawnMarkFailed` would truthfully report a failure that was really
 * this component never having been asked.
 */
watch(() => [props.name, props.modelValue], () => void render(), { immediate: true });

/** The option rows are CSS text, so they need the faces even before there is a name to render. */
onMounted(() => void loadSignatureFaces());

onBeforeUnmount(() => show(null));
</script>

<template>
  <div class="space-y-3">
    <p class="text-sm text-ink">{{ copy.styleChooseLabel }}</p>

    <!-- ⚠ `size="row"` is this repo's sanctioned full-width left-aligned row; a raw `<button>` in a
         feature fails `lint:ui-adoption` and an `!important` on the primitive fails
         `lint:template-integrity`. -->
    <ul class="space-y-2">
      <li v-for="style in MARK_STYLES" :key="style.id">
        <BaseButton
          size="row"
          block
          :variant="style.id === modelValue ? 'soft' : 'ghost'"
          :aria-pressed="style.id === modelValue"
          @click="emit('update:modelValue', style.id)"
        >
          <span class="flex w-full items-center justify-between gap-3">
            <span :class="['mark-face', `mark-face-${style.id}`, 'truncate text-2xl text-ink']">
              {{ name.trim() || copy.styleSampleName }}
            </span>
            <span class="shrink-0 text-xs text-ink-muted">{{ style.label }}</span>
          </span>
        </BaseButton>
      </li>
    </ul>

    <!--
      ⚠ The literal bytes that will be staged and printed — not a rendering of them. This is the one
      place on the screen where "what you see is what the form gets" is true by construction rather
      than by two things being kept in step, which is what C2 exists to fix.
    -->
    <div v-if="previewUrl">
      <p class="text-sm text-ink-muted">{{ copy.stylePreviewLabel }}</p>
      <!-- ⚠ `h-10` for `PacketAdoption`'s reason — the printed ratio of a mark to typed text, which is
           18pt to 11pt. The options above render at `text-2xl`, so a preview much taller than this
           reads as a promise that the signature will dwarf everything around it on the page. -->
      <img :src="previewUrl" alt="" class="mt-1 h-10 w-auto max-w-full object-contain object-left" />
    </div>
  </div>
</template>

<style scoped>
/*
 * The four faces, declared by `signatureFaces.css` — which this component's own module imports
 * dynamically, so the files are fetched here and on no other page in the product.
 *
 * ⚠ The `cursive` fallback is the honest one: if a face has not arrived the option still shows a
 * joined hand rather than the body font, so the list does not silently collapse into four identical
 * rows the driver would be choosing between at random.
 */
.mark-face {
  line-height: 1.6;
}
.mark-face-flowing {
  font-family: "Dancing Script", cursive;
  font-weight: 600;
}
.mark-face-handwritten {
  font-family: "Caveat", cursive;
  font-weight: 600;
}
.mark-face-formal {
  font-family: "Great Vibes", cursive;
}
.mark-face-fine {
  font-family: "Sacramento", cursive;
}
</style>
