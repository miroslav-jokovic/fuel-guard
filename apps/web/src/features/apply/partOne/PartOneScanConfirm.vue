<script setup lang="ts">
import { computed } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { formatDisplayDate } from "@silvicom/shared";
import { APPLY_COPY } from "@/features/apply/strings";
import type { PartOneAnswers, ScanFact } from "./partOneScreens";

/**
 * "Is this right?" — what the CDL's barcode read, confirmed on one screen (U2; SCREEN-MAP 1.4; D-AM5).
 *
 * Before this the barcode's answers were put into their boxes and the driver walked every one of those
 * screens to press Continue on what they had just photographed: four screens of agreeing. Here each
 * fact is read back once, as it will be filed, with one button under it. Left alone it is confirmed and
 * its screen is not asked; "Change" sends it to its own screen with the read value in the box.
 *
 * ⚠ The values are the driver's own — their licence, on their phone, seconds after they photographed
 * it — and they are in the page, not served: the bare link still reads no answer back (D-APP16).
 *
 * ⚠ Part 1 has no name box (the name is the office's, from the invitation, and is asked in "About
 * you"), so the name the barcode holds is not listed: this screen confirms what Part 1 would have asked.
 */
const props = defineProps<{ answers: PartOneAnswers; offered: readonly ScanFact[]; fixing: readonly ScanFact[] }>();
const emit = defineEmits<{ toggle: [fact: ScanFact] }>();

const copy = APPLY_COPY.partOne;

/** Each fact in the words of the screen that would have asked it, and its lines as they will be filed. */
const rows = computed(() => {
  const a = props.answers;
  const all: Record<ScanFact, { label: string; lines: string[] }> = {
    date_of_birth: { label: copy.about.dateOfBirth, lines: [formatDisplayDate(a.date_of_birth)] },
    address: {
      label: copy.address.heading,
      lines: [a.address_line1, a.address_line2, `${a.city}, ${a.state} ${a.postal_code}`].filter((l) => l.trim() !== ""),
    },
    licence: { label: copy.licence.number, lines: [`${a.cdl.state_code} ${a.cdl.licence_number}`] },
    expires_on: { label: copy.licence.expiresOn, lines: [formatDisplayDate(a.cdl.expires_on)] },
  };
  return props.offered.map((fact) => ({ fact, ...all[fact], fixing: props.fixing.includes(fact) }));
});
</script>

<template>
  <ul class="space-y-3" data-scan-confirm>
    <li v-for="row in rows" :key="row.fact" class="rounded-surface bg-surface-muted p-4" :data-scan-fact="row.fact">
      <!-- The answer on the left, its one button on the right: four facts fit a phone without scrolling. -->
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="text-xs font-medium text-ink-tertiary">{{ row.label }}</p>
          <p v-for="line in row.lines" :key="line" class="mt-0.5 break-words text-base text-ink">{{ line }}</p>
        </div>
        <BaseButton
          class="shrink-0"
          size="touch"
          variant="ghost"
          :aria-pressed="row.fixing"
          :aria-label="row.fixing ? copy.scan.keepNamed(row.label) : copy.scan.changeNamed(row.label)"
          @click="emit('toggle', row.fact)"
        >
          {{ row.fixing ? copy.scan.keep : copy.scan.change }}
        </BaseButton>
      </div>
      <p v-if="row.fixing" class="mt-2 text-sm text-ink-muted" role="status">{{ copy.scan.willAsk }}</p>
    </li>
  </ul>
</template>
