<script setup lang="ts">
import type { ShopWorkOrderDto } from "@silvicom/shared";
import { formatDate } from "@/lib/format";

/**
 * One unit's open work orders as rows — the fleet's window and the shop's hub draw the same list. With
 * `openable` each row is a button that asks its parent to open the order in full (F14's drawer); the
 * fleet's read-only window leaves it off and links to the shop instead.
 */
defineProps<{ orders: ShopWorkOrderDto[]; emptyText: string; openable?: boolean }>();
const emit = defineEmits<{ open: [id: string] }>();
</script>

<template>
  <ul class="divide-y divide-edge-subtle text-sm">
    <li v-for="o in orders" :key="o.id">
      <component
        :is="openable ? 'button' : 'div'"
        :type="openable ? 'button' : undefined"
        class="flex w-full items-center justify-between gap-4 px-5 py-2 text-left"
        :class="openable ? 'hover:bg-surface-subtle' : ''"
        @click="openable && emit('open', o.id)"
      >
      <span class="min-w-0 truncate text-ink">
        <span v-if="o.referenceNumber" class="font-mono text-xs text-ink-muted">{{ o.referenceNumber }}</span>
        {{ o.description ?? "Work order" }}
      </span>
      <span class="shrink-0 text-xs text-ink-muted">
        <template v-if="o.priority">{{ o.priority }} · </template>{{ o.openedAt ? formatDate(o.openedAt) : "—" }}
      </span>
      </component>
    </li>
    <li v-if="orders.length === 0" class="px-5 py-3 text-ink-muted">{{ emptyText }}</li>
  </ul>
</template>
