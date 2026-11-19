<script setup lang="ts">
import { computed, ref } from "vue";
import type { AdsSwipeEntryView } from "@silvicom/shared";
import { AppButton as BaseButton, AppCard as BaseCard, FactList, QueryState } from "@silvicom/ui";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDateTime } from "@/lib/format";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import AdsSwipeDrawer from "./AdsSwipeDrawer.vue";
import { SWIPE_STATE_LABEL, SWIPE_STATE_TONE, swipeDroppedWords, swipeEmptyWords, swipeReadingLines, swipeTitle } from "./adsSwipeWords";
import { useAdsSwipe, useSwipeAct } from "./useAdsSwipe";

/**
 * Ads › Creative studio's swipe file (V2r, D-AD36): what our recruiters saved of other carriers' recruiting, and
 * what the Researcher read from each. It is the Researcher's whole allow-list, so this card is what lets it work.
 *
 * Reading is a VIEW of recruiting; saving, "Read again" and "Archive" are a MANAGE grant — the API's
 * `requireSection("recruitment", "manage")`, asked here as `session.can("recruitment")`, so a viewer is never shown
 * a button the API would refuse. No save is offered while the list has failed to load, as for brand kits.
 */
const session = useSessionStore();
const swipe = useAdsSwipe();
const act = useSwipeAct();
const toast = useToastStore();
const canManage = computed(() => session.can("recruitment"));
const entries = computed(() => swipe.data.value ?? []);

const drawerOpen = ref(false);
const drawerKind = ref<"page" | "picture">("page");
function open(kind: "page" | "picture"): void {
  drawerKind.value = kind;
  drawerOpen.value = true;
}

async function run(e: AdsSwipeEntryView, what: "read" | "archive"): Promise<void> {
  try {
    await act.mutateAsync({ id: e.id, act: what });
    toast.success(what === "read" ? "It is being read again." : "Archived. It is no longer read for plans.");
  } catch (err) {
    toast.error(what === "read" ? "Could not read it again" : "Could not archive it", err instanceof Error ? err.message : undefined);
  }
}
</script>

<template>
  <BaseCard>
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 class="text-sm font-semibold text-ink">Swipe file</h2>
        <p class="text-sm text-ink-muted">Other carriers' job pages and ads you saved. The Researcher reads only these, and a plan may cite what they say.</p>
      </div>
      <div v-if="canManage && !swipe.error.value" class="flex gap-2">
        <BaseButton data-test="save-page" @click="open('page')">Save a job page</BaseButton>
        <BaseButton data-test="save-picture" @click="open('picture')">Save an ad picture</BaseButton>
      </div>
    </div>
    <QueryState :loading="swipe.isLoading.value" :error="swipe.error.value" error-text="Could not load the swipe file." :retrying="swipe.isFetching.value" @retry="swipe.refetch()">
      <p v-if="entries.length === 0" class="mt-4 text-sm text-ink-muted" data-test="no-swipe">
        Nothing saved yet, so the Researcher has nothing to read and plans cite no competitor.
      </p>
      <ul v-else class="mt-4 divide-y divide-edge">
        <li v-for="e in entries" :key="e.id" class="space-y-2 py-3" data-test="swipe-row">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0 space-y-0.5">
              <p class="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                <a v-if="e.kind === 'page' && e.url" :href="e.url" target="_blank" rel="noopener noreferrer nofollow" class="break-all underline">{{ swipeTitle(e) }}</a>
                <span v-else>{{ swipeTitle(e) }}</span>
                <span :class="[BADGE_BASE, toneClass(SWIPE_STATE_TONE[e.state])]" data-test="swipe-state">{{ SWIPE_STATE_LABEL[e.state] }}</span>
              </p>
              <p class="text-xs text-ink-muted">
                {{ e.kind === "page" ? "Job page" : "Ad picture" }} · saved {{ formatDateTime(e.created_at) }}<template v-if="e.created_by_name"> by {{ e.created_by_name }}</template><template v-if="e.read_at"> · read {{ formatDateTime(e.read_at) }}</template>
              </p>
              <p v-if="e.kind === 'page' && e.note" class="text-xs text-ink-muted">{{ e.note }}</p>
            </div>
            <div v-if="canManage" class="flex gap-2">
              <BaseButton v-if="e.state !== 'waiting'" :disabled="act.isPending.value" data-test="swipe-read-again" @click="run(e, 'read')">Read again</BaseButton>
              <BaseButton :disabled="act.isPending.value" data-test="swipe-archive" @click="run(e, 'archive')">Archive</BaseButton>
            </div>
          </div>
          <p v-if="swipeEmptyWords(e)" class="text-sm text-ink-muted" data-test="swipe-empty">{{ swipeEmptyWords(e) }}</p>
          <FactList v-if="swipeReadingLines(e).length > 0" :facts="swipeReadingLines(e)" :columns="2" data-test="swipe-reading">
            <template v-for="l in swipeReadingLines(e)" :key="l.key" #[`value-${l.key}`]>
              {{ l.value }}
              <q v-if="l.quote" class="block text-xs font-normal text-ink-muted">{{ l.quote }}</q>
            </template>
          </FactList>
          <p v-if="swipeDroppedWords(e.dropped)" class="text-xs text-ink-muted" data-test="swipe-dropped">{{ swipeDroppedWords(e.dropped) }}</p>
        </li>
      </ul>
    </QueryState>
    <AdsSwipeDrawer :open="drawerOpen" :kind="drawerKind" @close="drawerOpen = false" />
  </BaseCard>
</template>
