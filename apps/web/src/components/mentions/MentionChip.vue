<script setup lang="ts">
import { useMentionNames, type MentionNameOf } from "./mentionNames";

/**
 * One `<@id>` token drawn as a chip of the person's name (D-CHAT22). The body is the one record of what
 * was written; this only decides how a token looks. A mention of the reader is the stronger chip — the
 * one a reader scanning a channel, or a unit's notes, is looking for. A person nobody can name reads
 * "@someone", never the raw id.
 *
 * `userId` is the token as `chatBodyParts` hands it over (already lower-case); `viewerId` is compared
 * lower-cased. A caller's own marker (`data-chat-mention`) falls through to the span.
 *
 * Names come from the nearest `provideMentionNames` (chat's page), or from `nameOf` when the caller
 * already holds the lookup — a unit's note row is handed its drawer's `/api/notes/people` names (UN7).
 */
const props = defineProps<{ userId: string; viewerId: string; nameOf?: (userId: string) => string | null | undefined }>();
const injected: MentionNameOf = useMentionNames();
const name = (id: string) => (props.nameOf ?? injected)(id) ?? null;
</script>

<template>
  <span
    class="rounded px-0.5 font-medium"
    :class="props.userId === props.viewerId.toLowerCase() ? 'bg-brand-accent-strong text-ink' : 'bg-brand-50 text-brand-700'"
  >@{{ name(props.userId) ?? "someone" }}</span>
</template>
