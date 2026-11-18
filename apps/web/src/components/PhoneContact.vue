<script setup lang="ts">
import { computed } from "vue";
import { AppIcon } from "@silvicom/ui";
import { ChatBubbleIcon, PhoneIcon } from "@silvicom/ui/icons";
import { useTouchedWindow } from "@/composables/usePhoneFirst";
import { formatPhone, phoneDialString } from "@/lib/format";

/**
 * A phone number the reader can call or text from the device in their hand (small-screens, 2026-11-18).
 *
 * The office reads the roster on a phone — in the browser or the installed app — and the number it
 * finds there is the one it wants to ring. So on a touched window (`useTouchedWindow`: a coarse
 * pointer, or a window below `md` — the one definition the shell's touch floor already reads) the
 * number is a `tel:` link and two 44 px buttons sit beside it: Call (`tel:`) and Text (`sms:`). The
 * device's own dialler and messages app take it from there; nothing is sent through us, so nothing
 * here needs a permission, a provider, or an audit row.
 *
 * At a desk with a mouse the number stays plain text: a click there would launch FaceTime or Teams
 * when the reader most likely wanted to select and copy it, and the table keeps its density.
 *
 * A value no phone could dial (`phoneDialString` → null) is shown as stored, with no links.
 *
 * The desk branch is bare text, with no wrapping element and no template comment, so at a desk the
 * cell is byte-for-byte what it was before this component — "renders the roster table unchanged by
 * the R2 extraction" in `DriversPage.test.ts` snapshots that cell.
 */
const props = defineProps<{ phone: string | null | undefined; name?: string | null }>();

const touched = useTouchedWindow();
const dial = computed(() => phoneDialString(props.phone));
const shown = computed(() => formatPhone(props.phone));
const who = computed(() => props.name?.trim() || shown.value);
</script>

<template>
  <span v-if="touched && dial" class="inline-flex items-center gap-1">
    <a :href="`tel:${dial}`" class="text-ink-secondary underline-offset-2 hover:underline tabular-nums">{{ shown }}</a>
    <a
      :href="`tel:${dial}`"
      :aria-label="`Call ${who}`"
      class="inline-flex size-11 shrink-0 items-center justify-center rounded-control text-brand-600 hover:bg-surface-muted"
    >
      <AppIcon :icon="PhoneIcon" class="size-5" aria-hidden="true" />
    </a>
    <a
      :href="`sms:${dial}`"
      :aria-label="`Text ${who}`"
      class="inline-flex size-11 shrink-0 items-center justify-center rounded-control text-brand-600 hover:bg-surface-muted"
    >
      <AppIcon :icon="ChatBubbleIcon" class="size-5" aria-hidden="true" />
    </a>
  </span>
  <template v-else>{{ shown }}</template>
</template>
