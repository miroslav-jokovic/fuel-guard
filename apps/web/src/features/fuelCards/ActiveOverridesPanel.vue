<script setup lang="ts">
import { computed, ref } from "vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { activeOverrides } from "./cardControlModel";
import { operationById, operationLink } from "./cardOperations";
import { cardIdentityLabel } from "./cardIdentityLabel";
import { useEfsCards } from "./useEfsCards";
import { useRefreshCard } from "./useCardControl";
import { AppButton as BaseButton, DataTable, type DataTableColumn, QueryState } from "@silvicom/ui";
import { RouterLink, useRouter } from "vue-router";
import KebabMenu from "@/components/KebabMenu.vue";

/** One rule for naming a card to a human, shared with the inventory — see cardIdentityLabel.ts. */
const identity = cardIdentityLabel;

/**
 * Every active fuel exception on the account, in one place (audit B3).
 *
 * The fact this panel exists for: an override is free fuel, granted one card at a time — in this
 * product, in the WEX portal, by anyone with access — and until now the only way to see them all was
 * to sort a 199-row table by a column. An auditor's question is account-shaped ("who can currently
 * buy outside their limits?"), so the answer should be too.
 *
 * ── Its own query, NOT the page's ────────────────────────────────────────────────────────────────
 * The inventory below this panel filters server-side by search and status. This panel deliberately
 * runs the UNFILTERED list query: an operator who has narrowed the page to "Hold" cards must still
 * see the exception on an Active card — an account-wide claim built from a filtered response would
 * be silently wrong exactly when someone is mid-investigation. When the page is unfiltered the two
 * queries share one cache key, so the common case costs nothing extra. Freshness comes with the
 * same 60s poll as everything else (B6) — no refresh button here either.
 *
 * READ-ONLY by design. Granting and clearing stay in the card drawer with its confirmation copy,
 * step-up rules and idempotency keys; a quick "clear" button here would bypass none of them but
 * would invite clearing the wrong card from a list of look-alike last-fours.
 *
 * Step 6.3 adds `Remove exception…` per row and does NOT weaken that. It is a LINK to the card with
 * the operation preselected — the drawer still opens, still shows the card's own identity and its
 * before/after diff, and still demands the confirmation. What it removes is the four clicks between
 * spotting the exception here and being able to act on it, which is the actual complaint.
 *
 * ── Step 7.8: every row carries the age of the read behind it ───────────────────────────────────
 * "1 use left" is a claim about a moment, and this panel's whole promise is a claim about NOW.
 * Production card ••••7550 sat here reading "1 use left" for nine hours after EFS had retired the
 * exception (`docs/22` H4). A stale row is annotated rather than dropped — "we last read this two
 * days ago" is not the same answer as "no", and filtering would make the panel quietest exactly when
 * the mirror is worst — and `Re-read` spends one paced vendor call, on one card, when a person asks.
 *
 * ── A table, and a failure that says so (2026-10-14) ────────────────────────────────────────────
 * The sweep after US6b batch 3 found the rows hand-built as a wrapping line of five facts and two
 * actions, and a failed read drawing NOTHING — the same as before first data. Nothing-before-data
 * stays (see the template), but a failed read is now "Could not load…" with Retry: an account-wide
 * claim that silently vanishes when the read fails is the panel being quietest exactly when it
 * knows least. The rows are a `DataTable`, and Re-read / Remove exception… are the row's menu.
 */

// Unfiltered on purpose — see the docblock. Refs are stable for the component's lifetime.
const query = useEfsCards({ search: ref(""), status: ref("") });
const router = useRouter();

const COLUMNS: DataTableColumn[] = [
  { key: "maskedRef", label: "Card" },
  { key: "identity", label: "Unit and driver" },
  { key: "uses", label: "Override" },
  { key: "scopeLabel", label: "Where" },
  { key: "freshness", label: "Read" },
];

const rows = computed(() =>
  // The detail clock, not the roster one: override SCOPE is read only by the daily detail pass.
  activeOverrides(
    query.data.value?.cards ?? [],
    new Date(),
    query.data.value?.detailStaleAfterMinutes ?? query.data.value?.staleAfterMinutes,
  ),
);

const refresh = useRefreshCard();
/** Which card's re-read is in flight — the button is per row, so `isPending` alone cannot say. */
const refreshing = ref<string | null>(null);
const onReRead = (id: string): void => {
  refreshing.value = id;
  refresh.mutate(id, { onSettled: () => { refreshing.value = null; } });
};

/** Non-null by construction — `operationById` is exhaustive over `CARD_OPERATIONS`. */
const clearOperation = operationById("clear")!;

/** Loaded once ever — after that, cached data keeps rendering through background refetches. */
const loaded = computed(() => query.data.value !== undefined);
</script>

<template>
  <!-- Nothing renders before first data: a flash of "No exceptions" that corrects itself to two
       rows teaches operators the panel guesses. A FAILED read is not "before first data" — it says
       so, with Retry. -->
  <QueryState
    v-if="!loaded && query.isError.value"
    compact
    :loading="false"
    :error="query.isError.value"
    :retrying="query.isFetching.value"
    error-text="Could not load the active fuel overrides."
    @retry="query.refetch()"
  />
  <section v-else-if="loaded" class="space-y-3">
    <div class="flex items-baseline gap-2">
      <h2 class="text-sm font-semibold text-ink">Active fuel overrides</h2>
      <span v-if="rows.length > 0" :class="[BADGE_BASE, toneClass('warning')]">{{ rows.length }}</span>
    </div>

    <!-- The empty state is a positive assertion, not a hidden panel: "none" is the answer an
         auditor is looking for, and silence is indistinguishable from "didn't check". -->
    <DataTable
      dense
      :sticky-header="false"
      :columns="COLUMNS"
      :rows="rows"
      row-key="id"
      empty-text="No card currently carries a fuel override."
    >
      <template #cell-maskedRef="{ row }">
        <RouterLink :to="`/fuel-cards/${row.id}`" class="font-medium text-link hover:text-link-hover">{{ row.maskedRef }}</RouterLink>
      </template>
      <!--
        Step 7.7: unit AND driver, not one-or-the-other. `driverName ?? unitPrompt` printed
        whichever came first and HID the other — on a fleet where 40 last-4 groups hold more than
        one card, the hidden field is often the only thing telling two rows apart.
      -->
      <template #cell-identity="{ row }">
        <span v-if="!identity(row).unidentified" class="text-ink-muted">{{ identity(row).qualifier }}</span>
        <span v-else class="text-ink-muted italic">no unit or driver</span>
      </template>
      <!-- `known` gates the NUMBER, not the row. Past a sync cycle the count is what EFS said,
           not what EFS says, and it decrements without us — so it stops being asserted while the
           card stays listed. Same rule on the card page; one flag decides it in both. -->
      <template #cell-uses="{ row }">
        <span v-if="row.freshness.known" :class="[BADGE_BASE, toneClass('warning')]">
          {{ row.uses }} use{{ row.uses === 1 ? "" : "s" }} left
        </span>
        <span v-else :class="[BADGE_BASE, toneClass('caution')]">uses unknown</span>
      </template>
      <!-- Step 7.8. Muted while the read is current, cautioned once it is older than a sweep:
           past that the count is what EFS said, not what EFS says, and the count decrements
           without us. -->
      <template #cell-freshness="{ row }">
        <span class="text-xs" :class="row.freshness.known ? 'text-ink-tertiary' : 'text-caution-700'">
          {{ refreshing === row.id ? "Reading…" : row.freshness.ageText }}
        </span>
      </template>
      <template #actions="{ row }">
        <KebabMenu :trigger-label="`Actions for card ${row.maskedRef}`">
          <!-- One paced vendor call, on one card, when a person asks for it. See the docblock. -->
          <BaseButton class="kebab-item" :disabled="refreshing === row.id" @click="onReRead(row.id)">Re-read</BaseButton>
          <!-- Opens the drawer on the card, with its confirmation and its diff. Not a one-click clear. -->
          <BaseButton class="kebab-item" @click="router.push(operationLink(row.id, clearOperation))">Remove override…</BaseButton>
        </KebabMenu>
      </template>
    </DataTable>
  </section>
</template>
