<script setup lang="ts">
import { computed, onMounted, ref, toRef } from "vue";
import { AppButton as BaseButton, AppFormField as FormField, AppIcon, AppInput as BaseInput } from "@silvicom/ui";
import { ScanIcon } from "@silvicom/ui/icons";
import { IMEI_REFUSAL, readStickerCode, type StickerCode } from "@silvicom/shared";
import { useScanInput } from "@/composables/useScanInput";
import BarcodeCamera from "@/components/BarcodeCamera.vue";
import { STICKER_READER } from "./shopBarcodeFormats";

/**
 * "Scan the sticker" — the Add equipment form's first field (MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md
 * §7a.6, M9b; the owner, 2026-10-29: "scan the sticker on the back of the tablet and prefill the form").
 *
 * ── ONE FIELD FOR EVERY BARCODE ON THE STICKER ────────────────────────────────────────────────
 * The Tera Pro is a keyboard: it types the barcode it was aimed at and presses Enter, and nothing in
 * the keystrokes says whether that was the IMEI, the serial or the model. So the person does not say
 * either — they scan the sticker's barcodes in any order and `readStickerCode` sorts each one by its
 * shape; the form puts it in its field and this list says where it went. A code that is not stored
 * (the SIM's number, the box's retail barcode) is named and set aside, never silently dropped.
 *
 * ── ENTER AND TAB ARE CAUGHT HERE ─────────────────────────────────────────────────────────────
 * The scanner ends every read with Enter (or Tab, if somebody configured it so — R11), and Enter in
 * a form field submits the form: one trigger pull would have saved a half-filled tablet. Both keys
 * end a read here and do nothing else.
 *
 * ── AND A SCAN WITH NOTHING FOCUSED STILL LANDS ───────────────────────────────────────────────
 * `useScanInput`'s document listener — the Scan page's — catches a machine-speed burst while no field
 * has focus, so a person who opened the drawer and pulled the trigger without tapping anything gets
 * the same result. It ignores keystrokes into a field, so it never steals typing from one.
 *
 * ── AND WITH NO HANDHELD, THE CAMERA (M9c) ────────────────────────────────────────────────────
 * "Use the camera" opens `BarcodeCamera` over the drawer, reading Code 128 until it is closed. Each barcode it
 * reads goes through `take` — the function a handheld read goes through — so it lands in the same field with
 * the same line in the list, and the list is drawn under the camera's picture so the person sees it land. A
 * phone's or another tablet's camera, in practice: a tablet cannot see its own back.
 */
const props = defineProps<{
  /** Whether the drawer around this field is open; the document listener runs only then. */
  active: boolean;
  /** Focus the field on mount — true when adding, where scanning is the first thing a person does. */
  focusFirst?: boolean;
}>();
const emit = defineEmits<{ read: [code: StickerCode] }>();

const typed = ref("");
/** What the last few reads were, newest first — the person's proof that each barcode went somewhere. */
const log = ref<Array<{ id: number; text: string; tone: "ok" | "muted" | "danger" }>>([]);
let seq = 0;

function describe(code: StickerCode): { text: string; tone: "ok" | "muted" | "danger" } {
  switch (code.kind) {
    case "imei":
      return { text: `IMEI ${code.imei}`, tone: "ok" };
    case "serial":
      return { text: `Serial ${code.serial}`, tone: "ok" };
    case "model":
      return { text: `Model ${code.model} (${code.manufacturer})`, tone: "ok" };
    case "bad_imei":
      return { text: IMEI_REFUSAL, tone: "danger" };
    case "sim":
      return { text: "The SIM card's number — not stored. Scan the barcode marked IMEI.", tone: "muted" };
    case "box_barcode":
      return { text: "The box's shop barcode — not needed here.", tone: "muted" };
    case "unknown":
      return { text: `Not a barcode this form uses: ${code.code}`, tone: "muted" };
  }
}

function take(raw: string) {
  const text = raw.trim();
  if (!text) return;
  const code = readStickerCode(text);
  log.value = [{ id: (seq += 1), ...describe(code) }, ...log.value].slice(0, 4);
  emit("read", code);
}

function onEnd(event: KeyboardEvent) {
  event.preventDefault();
  if (event.key === "Tab" && !typed.value.trim()) return;
  take(typed.value);
  typed.value = "";
}

useScanInput({ enabled: toRef(props, "active"), onScan: take });

// `AppInput`'s root IS the `<input>`, so its `$el` is what takes focus.
const field = ref<{ $el?: HTMLInputElement } | null>(null);
const cameraOpen = ref(false);
onMounted(() => {
  if (props.focusFirst) field.value?.$el?.focus();
});
const TONE = { ok: "text-ink", muted: "text-ink-tertiary", danger: "font-medium text-danger-700" } as const;
const hasLog = computed(() => log.value.length > 0);
</script>

<template>
  <div class="rounded-control bg-surface-subtle p-4 ring-1 ring-edge">
    <FormField
      v-slot="{ id }"
      label="Scan the sticker"
      hint="Aim the scanner at each barcode on the back — IMEI, serial, model — in any order. Each one goes into its field below."
    >
      <!-- Stacked on a phone, where the button beside it left the field 105 px wide (M9c's pass, 390 px). -->
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
        <BaseInput
          :id="id"
          ref="field"
          v-model="typed"
          class="min-w-0 sm:flex-1"
          autocomplete="off"
          autocapitalize="characters"
          data-test="sticker-scan"
          @keydown.enter="onEnd"
          @keydown.tab="onEnd"
        />
        <BaseButton type="button" variant="secondary" data-test="sticker-camera" @click="cameraOpen = true">
          <AppIcon :icon="ScanIcon" class="size-5" aria-hidden="true" />
          Use the camera
        </BaseButton>
      </div>
    </FormField>
    <ul v-if="hasLog" class="mt-3 space-y-1 text-sm" aria-live="polite" data-test="sticker-log">
      <li v-for="entry in log" :key="entry.id" :class="TONE[entry.tone]">{{ entry.text }}</li>
    </ul>
    <!-- Rendered here, inside the drawer's slot, so Escape closes the camera and not the drawer too
         (`BarcodeCamera`'s header). -->
    <BarcodeCamera
      v-if="cameraOpen"
      title="Scan the sticker"
      hint="Hold the sticker inside the box — IMEI, serial, model, one at a time."
      :reader="STICKER_READER"
      @read="take"
      @close="cameraOpen = false"
    >
      <ul v-if="hasLog" class="space-y-1 text-sm" data-test="sticker-camera-log">
        <li v-for="entry in log" :key="entry.id">{{ entry.text }}</li>
      </ul>
    </BarcodeCamera>
  </div>
</template>
