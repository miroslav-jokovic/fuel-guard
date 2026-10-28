<script setup lang="ts">
import type { ShopWorkOrderDto } from "@silvicom/shared";
import { formatDate } from "@/lib/format";

/** One unit's open work orders as rows — the fleet's window and the shop's hub draw the same list. */
defineProps<{ orders: ShopWorkOrderDto[]; emptyText: string }>();
</script>

<template>
  <ul class="divide-y divide-edge-subtle text-sm">
    <li v-for="o in orders" :key="o.id" class="flex items-center justify-between gap-4 px-5 py-2">
      <span class="min-w-0 truncate text-ink">
        <span v-if="o.referenceNumber" class="font-mono text-xs text-ink-muted">{{ o.referenceNumber }}</span>
        {{ o.description ?? "Work order" }}
      </span>
      <span class="shrink-0 text-xs text-ink-muted">
        <template v-if="o.priority">{{ o.priority }} · </template>{{ o.openedAt ? formatDate(o.openedAt) : "—" }}
      </span>
    </li>
    <li v-if="orders.length === 0" class="px-5 py-3 text-ink-muted">{{ emptyText }}</li>
  </ul>
</template>
