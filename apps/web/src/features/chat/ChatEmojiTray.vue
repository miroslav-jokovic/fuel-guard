<script setup lang="ts">
import { AppButton as BaseButton } from "@silvicom/ui";
import { SmileIcon } from "@silvicom/ui/icons";
import KebabMenu from "@/components/KebabMenu.vue";

/**
 * The composer's emoji tray (D-CHATUI23, 2026-11-01). An emoji typed into a line is just text — the
 * body is UTF-8 and nothing on the server reads it — so this needs no contract, unlike reactions,
 * which are a fixed six in the database (D-CHAT26, `CHAT_REACTIONS`) and arrive with CH6c-2.
 *
 * A short, chosen set rather than a full Unicode picker: an office that writes about loads, trucks and
 * shifts uses a few dozen, and a 3,600-glyph picker would be the composer's heaviest dependency for
 * the least-used act. The first row is the six reactions, so the tray and the reaction bar agree.
 */
const emit = defineEmits<{ pick: [emoji: string] }>();

const EMOJI = [
  "👍", "❤️", "😂", "😮", "😢", "✅",
  "🙏", "👏", "🙌", "👀", "🔥", "💯",
  "😊", "😅", "🤔", "😬", "🙂", "😉",
  "⚠️", "❗", "❓", "⏰", "📍", "📎",
  "🚚", "🛣️", "⛽", "🔧", "📦", "📄",
  "☕", "🎉", "👋", "✋", "👌", "🤝",
] as const;
</script>

<template>
  <KebabMenu trigger-label="Add emoji" :icon="SmileIcon" placement="top-start" width="wide">
    <div class="grid grid-cols-6 gap-0.5 px-2 py-1" role="group" aria-label="Emoji">
      <BaseButton v-for="e in EMOJI" :key="e" size="icon" variant="ghost" class="text-lg" :aria-label="e" @click="emit('pick', e)">{{ e }}</BaseButton>
    </div>
  </KebabMenu>
</template>
