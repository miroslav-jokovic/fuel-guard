<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton, AppCallout, AppIcon, AppTabs, useQueryState } from "@silvicom/ui";
import { ArrowUpTrayIcon, PlusIcon } from "@silvicom/ui/icons";
import PageHeader from "@/components/ui/PageHeader.vue";
import ExplainerPanel from "@/components/ui/ExplainerPanel.vue";
import { useSessionStore } from "@/stores/session";
import { useVehiclesQuery } from "@/composables/useVehicles";
import TollStatementUploadDrawer from "@/features/tolls/TollStatementUploadDrawer.vue";
import TollStatementsList from "@/features/tolls/TollStatementsList.vue";
import TollTagDialog from "@/features/tolls/TollTagDialog.vue";
import TollTagImportDrawer from "@/features/tolls/TollTagImportDrawer.vue";
import TollTagsList from "@/features/tolls/TollTagsList.vue";
import type { TollTagAction } from "@/features/tolls/tollTagLabel";
import { useTollStatementsQuery } from "@/features/tolls/useTollStatements";
import { useTollTagsQuery } from "@/features/tolls/useTollTags";
import { statementStatus } from "@/features/tolls/tollStatementRows";

/**
 * Tolls (TOLLS-PER-TRUCK-PLAN.md TL4a, TL2b): the two things a toll needs to reach a truck, side by
 * side. **Statements** are the files E-ZPass, K-TAG and ExpressToll send, kept exactly as uploaded;
 * **Toll tags** say which truck carried which tag from which day, and so decide whose each toll is
 * (D-TL3). The tab is in the URL (`?view=tags`), so either can be linked to.
 *
 * ── EACH TAB ANSWERS TO ITS OWN SECTION ──────────────────────────────────────────────────────
 * The page is a Finance screen (`finance.tolls`, gated on accounting): statements carry the money.
 * The tags are the trucks' papers and stay on `equipment` (D-TL11), exactly as on the truck page and
 * in the API — so the Toll tags tab shows to whoever may view equipment, and adding or importing tags
 * to whoever manages it. An accountant without equipment sees the statements alone; a fleet manager
 * without accounting cannot reach this page and keeps the truck page's card (Q-TL6).
 */
const qs = useQueryState();
const view = qs.param("view", ["tags"] as const);
const session = useSessionStore();
const canSeeTags = computed(() => session.canView("equipment"));
const onTags = computed(() => view.value === "tags" && canSeeTags.value);
const canUpload = computed(() => session.can("accounting"));
const canManageTags = computed(() => session.can("equipment"));

const statementsQ = useTollStatementsQuery();
const unread = computed(() => (statementsQ.data.value ?? []).filter((s) => statementStatus(s) === "unread").length);
// A refused statement is named apart from an unread one: someone must act on it (TL4b).
const refused = computed(() => (statementsQ.data.value ?? []).filter((s) => statementStatus(s) === "refused").length);
const tagsQ = useTollTagsQuery(undefined, canSeeTags);
const { data: vehicles } = useVehiclesQuery();
const tagCount = computed(() => (tagsQ.data.value ?? []).filter((t) => !t.retiredAt).length);

const tabs = computed(() => [
  { value: "statements", label: "Statements" },
  ...(canSeeTags.value ? [{ value: "tags", label: "Toll tags", ...(tagsQ.data.value ? { badge: tagCount.value } : {}) }] : []),
]);
/** Switching tab clears the other list's filters and open drawer, which share the URL's names. */
function setView(v: string) {
  qs.set({ view: v === "tags" ? "tags" : undefined, search: undefined, provider: undefined, show: undefined, status: undefined, statement: undefined, tag: undefined, page: undefined });
}

const uploading = ref(false);
const importing = ref(false);
const adding = ref<TollTagAction | null>(null);
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="The statements your toll providers send, and the tags that say which truck each toll belongs to.">
      <template #actions>
        <template v-if="onTags && canManageTags">
          <AppButton data-test="tags-import" @click="importing = true">
            <AppIcon :icon="ArrowUpTrayIcon" class="size-4" aria-hidden="true" />
            Import from Excel
          </AppButton>
          <AppButton variant="primary" data-test="tags-add" @click="adding = { kind: 'add' }">
            <AppIcon :icon="PlusIcon" class="size-4" aria-hidden="true" />
            Add tag
          </AppButton>
        </template>
        <AppButton v-else-if="!onTags && canUpload" variant="primary" data-test="statements-upload" @click="uploading = true">
          <AppIcon :icon="ArrowUpTrayIcon" class="size-4" aria-hidden="true" />
          Upload statements
        </AppButton>
      </template>
    </PageHeader>

    <AppTabs v-if="tabs.length > 1" :model-value="onTags ? 'tags' : 'statements'" :tabs="tabs" label="Tolls view" @update:model-value="setView" />

    <AppCallout v-if="!onTags && refused > 0" tone="danger" data-test="statements-refused">
      {{ refused }} {{ refused === 1 ? "statement" : "statements" }} could not be read, so {{ refused === 1 ? "its" : "their" }} tolls do not count.
      Open {{ refused === 1 ? "it" : "each one" }} to see why.
    </AppCallout>
    <AppCallout v-if="!onTags && unread > 0" tone="info" data-test="statements-unread">
      {{ unread }} {{ unread === 1 ? "statement is" : "statements are" }} kept but not read yet. The tolls inside do not count until
      {{ unread === 1 ? "it is" : "each is" }} read and adds up to every total it prints. Open a statement and press Read.
    </AppCallout>

    <ExplainerPanel summary="How a toll reaches a truck">
      <p>
        A statement lists every toll by the tag that paid it. Each toll is charged to the truck that had that tag
        on the day of the toll, never spread across the fleet by miles.
      </p>
      <p>
        So every tag must be on file from the day it went on its truck. Under
        <span class="font-medium text-ink">Toll tags</span>, add them one at a time or import a spreadsheet of the
        whole fleet, using the real day even months back. Statements for earlier months then reach the right truck too.
      </p>
    </ExplainerPanel>

    <TollTagsList v-if="onTags" />
    <TollStatementsList v-else />

    <TollStatementUploadDrawer :open="uploading" @close="uploading = false" />
    <TollTagImportDrawer :open="importing" :vehicles="vehicles ?? []" :tags="tagsQ.data.value ?? []" @close="importing = false" />
    <TollTagDialog :action="adding" @close="adding = null" />
  </div>
</template>
