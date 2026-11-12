<script setup lang="ts">
import { computed } from "vue";
import { chatBodyParts, chatLinkParts, type ChatLineLink } from "@silvicom/shared";
import MentionChip from "@/components/mentions/MentionChip.vue";
import { chatAboutRoute } from "./useChatAbout";

/**
 * A line's words, with each `<@id>` token drawn as a chip of the person's name (D-CHAT22,
 * `MentionChip`, shared with a unit's notes since UN4).
 *
 * `links` (Q-CHATUI6 (a), 0547): the words of this line the server found to be a load or a truck, drawn
 * as links to that record's page — the same pages "Chat about this" links (`chatAboutRoute`). Only the
 * words between mentions are cut; a mention is never a link.
 */
const props = defineProps<{ body: string; viewerId: string; links?: readonly ChatLineLink[] }>();
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
    <MentionChip v-else :user-id="p.mention" :viewer-id="viewerId" data-chat-mention />
  </template>
</template>
