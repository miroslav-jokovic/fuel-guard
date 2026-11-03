<script setup lang="ts">
import { computed, ref } from "vue";
import { APPLICANT_DOCUMENT_KINDS, DQ_KIND_LABELS, newestPaperFirst, type DocumentRow } from "@silvicom/shared";
import { AppButton as BaseButton, AppIcon, QueryState } from "@silvicom/ui";
import { DocumentTextIcon } from "@silvicom/ui/icons";
import FileGallery from "@/components/files/FileGallery.vue";
import { useDocumentsQuery } from "@/composables/useCompliance";

/**
 * Every picture the applicant sent, in the Part 1 drawer, opened in the gallery the trucks and trailers
 * use (HIRING-WORKFLOW-AUDIT §14, D-OF6, owner 2026-11-03: *"it is missing all images that Applicant has
 * uploaded … displayed similar way as we did for vehicles and Trailers"*).
 *
 * ── THE SAME DOOR AND THE SAME VIEWER, NOT A RECRUITMENT COPY ──────────────────────────────────
 * Part 1 FILES its photographs as the driver's `documents` when it finishes (D-AW4,
 * `complete_applicant_intake`), so they are papers on the driver's file like any other, read through
 * `/api/compliance/documents` — which a recruiter may read (`roster: view`, the file section of a driver's
 * paper) and which already drops the picture of an SSN card or a passport for a role that may not see it
 * (Q-WF4). The gallery is `FileGallery` itself, narrowed to the kinds the applicant's own list produces
 * (`APPLICANT_DOCUMENT_KINDS`) so the office's signed packet and the MVR do not crowd the applicant's photos.
 *
 * ⚠ A capture still on the link (Part 1 not finished) is not a filed paper and is not here; the record
 * page's documents section lists those with "Filed when the applicant finishes".
 */
const props = defineProps<{ driverId: string; fullName: string }>();

const docsQ = useDocumentsQuery(computed(() => "driver"), computed(() => props.driverId));
const photos = computed<DocumentRow[]>(() =>
  (docsQ.data.value ?? []).filter((d) => APPLICANT_DOCUMENT_KINDS.includes(d.kind as never)).sort(newestPaperFirst));

const open = ref<string | null>(null);
const label = (d: DocumentRow) => DQ_KIND_LABELS[d.kind] ?? d.kind;
const thumb = (d: DocumentRow) => d.thumbUrl ?? (d.contentType.startsWith("image/") ? d.url : null);
</script>

<template>
  <section aria-labelledby="applicant-photos" class="space-y-2" data-testid="applicant-photos">
    <h4 id="applicant-photos" class="text-xs font-semibold text-ink-secondary">What they sent</h4>
    <QueryState
      :loading="docsQ.isLoading.value"
      :error="docsQ.isError.value ? docsQ.error.value : null"
      :retrying="docsQ.isFetching.value"
      loading-text="Loading their photos…"
      error-text="Could not load their photos."
      compact
      @retry="docsQ.refetch()"
    >
      <p v-if="photos.length === 0" class="text-xs text-ink-muted">
        Nothing filed yet. Their photos are filed here when they finish Part 1.
      </p>
      <ul v-else class="flex flex-wrap gap-3">
        <li v-for="d in photos" :key="d.id" class="w-14">
          <BaseButton
            variant="ghost"
            size="thumb"
            class="overflow-hidden rounded-detail ring-1 ring-edge"
            :aria-label="`Open ${label(d)}`"
            data-test="applicant-photo"
            @click="open = d.id"
          >
            <img v-if="thumb(d)" :src="thumb(d)!" alt="" class="size-full object-cover" loading="lazy" />
            <AppIcon v-else :icon="DocumentTextIcon" class="size-6 text-ink-tertiary" aria-hidden="true" />
          </BaseButton>
          <p class="mt-1 truncate text-2xs text-ink-muted" :title="label(d)">{{ label(d) }}</p>
        </li>
      </ul>
    </QueryState>
    <FileGallery
      :subject="open ? { type: 'driver', id: driverId } : null"
      :subject-label="fullName"
      :start-id="open"
      :kinds="APPLICANT_DOCUMENT_KINDS"
      @close="open = null"
    />
  </section>
</template>
