<!-- ui-adoption: not-a-record — the token is a public link, not a record id (`ApplyPage.vue`'s own
     marker says why): every dead link answers identically, and this door hands a dead link to that page. -->
<script setup lang="ts">
import { computed, watch } from "vue";
import { useRoute } from "vue-router";
import ApplyPage from "@/pages/ApplyPage.vue";
import DocumentsOnlyScreen from "@/features/apply/DocumentsOnlyScreen.vue";
import { isDocumentsLinkBundle } from "@/features/apply/documentsLink";
import { useApplyInvitationQuery } from "@/features/apply/useApplication";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * `/apply/:token` — which page the link opens (Q-AM19, 0608).
 *
 * Two kinds of link share this address: the application's own (the invitation's, the signing link, the
 * text's), and the documents-only link the office sends. The server says which by what it answers
 * with, and the two bundles have nothing in common but the carrier's name.
 *
 * ⚠ **Chosen HERE, above `ApplyPage`, and only once the link has answered.** `ApplyPage` reads phases,
 * releases and a draft from its first tick; handed the documents bundle it would read keys that are not
 * there. So nothing below is mounted while the answer is on its way. A dead link is `ApplyPage`'s to
 * say (it holds what this phone remembers of the link), and it asks the same query, already answered.
 */
const route = useRoute();
const emit = defineEmits<{ carrier: [string | null]; wide: [boolean] }>();
const token = computed(() => String(route.params.token ?? ""));
const link = useApplyInvitationQuery(token);
const documents = computed(() => (isDocumentsLinkBundle(link.data.value) ? link.data.value : null));
// The layout's header names the carrier; `ApplyPage` reports it for its own links, this for the other.
watch(documents, (bundle) => { if (bundle) emit("carrier", bundle.carrier); }, { immediate: true });
</script>

<template>
  <div v-if="link.isLoading.value" class="text-sm text-ink-muted">{{ APPLY_COPY.page.opening }}</div>
  <DocumentsOnlyScreen v-else-if="documents" :token="token" :bundle="documents" />
  <ApplyPage v-else @carrier="emit('carrier', $event)" @wide="emit('wide', $event)" />
</template>
