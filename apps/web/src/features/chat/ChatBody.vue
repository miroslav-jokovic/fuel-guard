<script setup lang="ts">
import { computed } from "vue";
import { chatBodyParts, chatLinkParts, type ChatLineLink } from "@silvicom/shared";
import { chatAboutRoute } from "./useChatAbout";
import { useChatNames } from "./chatNames";

/**
 * A line's words, with each `<@id>` token drawn as a chip of the person's name (D-CHAT22). The body is
 * the one record of what was written; this only decides how a token looks. A mention of the reader is
 * the stronger chip — the one a reader scanning a channel is looking for.
 *
 * `links` (Q-CHATUI6 (a), 0547): the words of this line the server found to be a load or a truck, drawn
 * as links to that record's page — the same pages "Chat about this" links (`chatAboutRoute`). Only the
 * words between mentions are cut; a mention is never a link.
 */
const props = defineProps<{ body: string; viewerId: string; links?: readonly ChatLineLink[] }>();
const nameOf = useChatNames();
type Part = { text: string } | { mention: string } | { link: string; kind: ChatLineLink["kind"]; record_id: string };
const parts = computed<Part[]>(() =>
  chatBodyParts(props.body).flatMap((p): Part[] => ("text" in p && props.links?.length ? chatLinkParts(p.text, props.links) : [p])),
);
</script>

<template>
  <template v-for="(p, i) in parts" :key="i">
    <template v-if="'text' in p">{{ p.text }}</template>
    <RouterLink
      v-else-if="'link' in p"
      :to="chatAboutRoute(p.kind, p.record_id)"
      class="font-medium text-link underline decoration-dotted underline-offset-2 hover:text-link-hover"
      data-chat-link
    >{{ p.link }}</RouterLink>
    <span
      v-else
      class="rounded px-0.5 font-medium"
      :class="p.mention === viewerId.toLowerCase() ? 'bg-brand-accent-strong text-ink' : 'bg-brand-50 text-brand-700'"
      data-chat-mention
    >@{{ nameOf(p.mention) ?? "someone" }}</span>
  </template>
</template>
