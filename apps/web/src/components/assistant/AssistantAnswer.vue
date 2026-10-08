<script setup lang="ts">
import { computed } from "vue";
import { parseAnswer } from "./answerBlocks";
import AssistantInlines from "./AssistantInlines.vue";

/**
 * One answer, rendered from blocks (`answerBlocks.ts`) — text nodes only, never `v-html`; the
 * reason is in that file's header.
 *
 * The table is drawn here rather than with `DataTable`: an answer's columns are whatever the model
 * chose for this one question, there is nothing to sort, page or select, and the table sits inside a
 * chat column 400 px wide. It keeps the product's number rule all the same — figures right-aligned
 * with tabular digits (D-DS1), text left.
 */
const props = defineProps<{ text: string }>();
const blocks = computed(() => parseAnswer(props.text));
</script>

<template>
  <div class="space-y-3 text-sm leading-6 text-ink-secondary">
    <template v-for="(b, i) in blocks" :key="i">
      <p v-if="b.type === 'paragraph'"><AssistantInlines :inlines="b.inlines" /></p>
      <p v-else-if="b.type === 'heading'" class="font-semibold text-ink"><AssistantInlines :inlines="b.inlines" /></p>
      <component
        :is="b.ordered ? 'ol' : 'ul'"
        v-else-if="b.type === 'list'"
        :class="['space-y-1 pl-5', b.ordered ? 'list-decimal' : 'list-disc marker:text-ink-tertiary']"
      >
        <li v-for="(item, j) in b.items" :key="j" class="pl-1"><AssistantInlines :inlines="item" /></li>
      </component>
      <div v-else-if="b.type === 'table'" class="overflow-x-auto rounded-control ring-1 ring-edge-subtle">
        <table class="min-w-full text-xs">
          <thead class="bg-surface-subtle">
            <tr>
              <th
                v-for="(h, c) in b.head"
                :key="c"
                scope="col"
                :class="['whitespace-nowrap px-3 py-2 font-medium text-ink-secondary', b.numeric[c] ? 'text-right' : 'text-left']"
              >
                <AssistantInlines :inlines="h" />
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-edge-subtle">
            <tr v-for="(row, r) in b.rows" :key="r">
              <td
                v-for="(cell, c) in row"
                :key="c"
                :class="['px-3 py-1.5 text-ink', b.numeric[c] ? 'whitespace-nowrap text-right tabular-nums' : 'text-left']"
              >
                <AssistantInlines :inlines="cell" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
