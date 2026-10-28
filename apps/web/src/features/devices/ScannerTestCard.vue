<script setup lang="ts">
import { computed, ref } from "vue";
import { AppCallout, AppCard as BaseCard } from "@silvicom/ui";
import { diagnoseScannerTest, type ScannerTestVerdict } from "@silvicom/shared";
import { useScanInput } from "@/composables/useScanInput";

/**
 * "Does the scanner work on THIS device?" (PRINTERS-AND-SCANNERS-PLAN.md §3).
 *
 * A handheld scanner is a keyboard for whatever it is paired with, so there is nothing to select —
 * and no browser can list one. What CAN go wrong is a setting on the device in hand, and a scan of
 * the printer's test label names which: the keyboard layout (the colon in every Silvicom label turns
 * into another character) or Caps Lock. The listener is the Scan screen's own (`useScanInput`), so a
 * pass here is a pass there.
 */

const props = defineProps<{ enabled: boolean }>();
const last = ref<{ text: string; verdict: ScannerTestVerdict } | null>(null);

useScanInput({
  enabled: computed(() => props.enabled),
  onScan: (text) => {
    last.value = { text, verdict: diagnoseScannerTest(text) };
  },
});

const isApple = /iPhone|iPad|Macintosh/.test(typeof navigator === "undefined" ? "" : navigator.userAgent);
const isAndroid = /Android/.test(typeof navigator === "undefined" ? "" : navigator.userAgent);
const layoutFix = isAndroid
  ? "Settings → System → Keyboard → Physical keyboard → the scanner → English (US)."
  : isApple
    ? "Set the scanner itself to US English with the setup barcode in its manual (iPhone and iPad have no per-keyboard layout)."
    : "Windows: Settings → Time & language → Language & region → make English (United States) with the US keyboard the first input method. Mac: System Settings → Keyboard → Input Sources → add U.S.";
</script>

<template>
  <BaseCard>
    <h3 class="text-sm font-semibold text-ink">Test a scanner on this device</h3>
    <p class="mt-1 text-sm text-ink-muted">
      Pair the scanner with this phone, tablet or computer (Bluetooth, or its USB receiver), print a test label from a
      printer below, and scan it here. Any number of scanners work — each one with the device it is paired to.
    </p>
    <p v-if="!last" class="mt-4 text-sm text-ink-tertiary">Waiting for a scan…</p>
    <div v-else class="mt-4 space-y-2" data-testid="scanner-verdict">
      <AppCallout v-if="last.verdict === 'works'" tone="success">Works. This scanner is ready on this device.</AppCallout>
      <AppCallout v-else-if="last.verdict === 'caps_lock'" tone="caution">
        Caps Lock is on, so every letter came out the wrong case. Turn it off on this device and scan again.
      </AppCallout>
      <AppCallout v-else-if="last.verdict === 'keyboard_layout'" tone="caution">
        The punctuation came out wrong, which means this device is not using a US English keyboard for the scanner —
        real labels will read as "not a code we know". {{ layoutFix }}
      </AppCallout>
      <AppCallout v-else tone="info">That is not the test label. Print one from a printer below and scan that.</AppCallout>
      <p class="text-xs text-ink-tertiary">Read: <span class="font-mono">{{ last.text }}</span></p>
    </div>
  </BaseCard>
</template>
