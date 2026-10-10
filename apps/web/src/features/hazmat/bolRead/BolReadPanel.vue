<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { AppButton as BaseButton, AppCallout, AppCard as BaseCard, AppCheckbox, AppIcon, AppIconButton } from "@silvicom/ui";
import { ChevronLeftIcon, ChevronRightIcon, DocumentTextIcon, XMarkIcon } from "@silvicom/ui/icons";
import { INTAKE_LIMITS, type ReadResponse } from "@silvicom/shared";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import { apiFetch } from "@/lib/api";
import { sha256Hex } from "@/composables/useCompliance";
import { useToastStore } from "@/stores/toast";
import {
  addFiles, BOL_ACCEPT, canPreview, includedFiles, moveFile, removeFile, toggleFile, type BolFile,
} from "./bolFiles";
import { readBol, type BolReadIo, type BolReadOutcome, type BolReadStage } from "./bolReadPipeline";

/**
 * "Read from a bill of lading" on the Placard calculator (DOCUMENT-READER-PLAN §7A N2, the owner's flow of
 * 2026-10-10): drop or pick the photos of ONE BOL — from the computer, or on a phone the camera, the
 * gallery or files — see them as pages in order, untick the ones that are not the BOL, move a page
 * earlier or later, and press Read. The pipeline (`bolReadPipeline.ts`) sends them, groups them into one
 * document in that order, and reads it.
 *
 * The read's result is EMITTED (`read`), not used here: filling the form from it, with each field's
 * state and what the shipper left out, is N6 (`bolPrefill.ts`, Step 3.3). Until then the panel says
 * what was read — how many pages, and which were taken for the BOL.
 */
const emit = defineEmits<{ read: [read: ReadResponse] }>();

const toast = useToastStore();
const files = ref<BolFile[]>([]);
const stage = ref<BolReadStage | null>(null);
// shallowRef: the read's `result` is a JSON value, and a deep ref of it is a type vue-tsc cannot finish.
const outcome = shallowRef<BolReadOutcome | null>(null);
let keySeq = 0;

const busy = computed(() => stage.value !== null);
const pages = computed(() => includedFiles(files.value));
const pageNumber = (f: BolFile) => pages.value.indexOf(f) + 1;

// One object URL per previewable file, revoked when the file leaves the list or the panel unmounts.
const previews = new Map<string, string>();
const previewOf = (f: BolFile): string | null => {
  if (!canPreview(f.mime)) return null;
  if (!previews.has(f.key)) previews.set(f.key, URL.createObjectURL(f.file));
  return previews.get(f.key)!;
};
watch(files, (now) => {
  const live = new Set(now.map((f) => f.key));
  for (const [key, url] of previews) if (!live.has(key)) { URL.revokeObjectURL(url); previews.delete(key); }
});
onBeforeUnmount(() => { for (const url of previews.values()) URL.revokeObjectURL(url); });

function onFiles(picked: File[]) {
  const { files: next, skipped } = addFiles(files.value, picked, () => `f${++keySeq}`);
  files.value = next;
  outcome.value = null;
  if (skipped.length === 1) toast.warning(`${skipped[0]!.name} was not added`, skipped[0]!.reason);
  else if (skipped.length > 1) toast.warning(`${skipped.length} files were not added`, skipped.map((s) => `${s.name}: ${s.reason}`).join(" "));
}
const edit = (next: BolFile[]) => { files.value = next; outcome.value = null; };

const io: BolReadIo = {
  api: (path, init) => apiFetch(path, init),
  put: async (url, file, mime) => {
    // The signed URL carries its own token; the bytes go to Storage, never through the API.
    const res = await fetch(url, { method: "PUT", headers: { "content-type": mime }, body: file });
    if (!res.ok) throw new Error(`upload ${res.status}`);
  },
  sha256: async (file) => sha256Hex(await file.arrayBuffer()),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

async function read() {
  outcome.value = null;
  stage.value = { kind: "uploading", done: 0, total: pages.value.length };
  let out: BolReadOutcome;
  try {
    out = await readBol(io, pages.value, (s) => (stage.value = s));
  } catch (e) {
    out = { kind: "failed", message: e instanceof Error ? e.message : "The read did not finish." };
  } finally {
    stage.value = null;
  }
  outcome.value = out;
  if (out.kind === "done") emit("read", out.read);
}

const stageText = computed(() => {
  const s = stage.value;
  if (!s) return "";
  if (s.kind === "uploading") return `Uploading page ${Math.min(s.done + 1, s.total)} of ${s.total}…`;
  if (s.kind === "preparing") return `Preparing pages… ${s.done} of ${s.total} ready`;
  return "Reading the bill of lading…";
});

const readPages = computed(() => (outcome.value?.kind === "done" ? outcome.value.read.pages : []));
const bolPages = computed(() => readPages.value.filter((p) => p.pageClass === null || p.pageClass === "bol" || p.pageClass === "delivery_copy").length);
const hint = `Several photos of one BOL are its pages, read in the order shown. PDF, JPEG, PNG, WebP or HEIC, up to ${INTAKE_LIMITS.maxBytes / 1024 / 1024} MB each.`;
</script>

<template>
  <BaseCard>
    <div class="space-y-4">
      <div>
        <h2 class="text-base font-semibold text-ink">Read from a bill of lading</h2>
        <p class="mt-1 text-sm text-ink-secondary">
          Add the photos or the PDF of one BOL. Untick anything that is not the BOL, and put the pages in order.
        </p>
      </div>

      <FileDropzone
        :accept="BOL_ACCEPT"
        multiple
        :busy="busy"
        busy-label="Reading…"
        label="Drop the BOL's photos or PDF here"
        :hint="hint"
        @files="onFiles"
      />

      <ol v-if="files.length" class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Pages to read">
        <li
          v-for="(f, i) in files"
          :key="f.key"
          class="flex flex-col gap-2 rounded-surface p-2 ring-1"
          :class="f.included ? 'bg-surface ring-edge' : 'bg-surface-muted opacity-60 ring-edge'"
          :data-testid="`bol-file-${i}`"
        >
          <div class="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-control bg-surface-muted">
            <img v-if="previewOf(f)" :src="previewOf(f)!" :alt="f.file.name" class="size-full object-contain" />
            <AppIcon v-else :icon="DocumentTextIcon" class="size-10 text-ink-tertiary" aria-hidden="true" />
          </div>
          <p class="truncate text-xs text-ink-secondary" :title="f.file.name">
            <span v-if="f.included" class="font-semibold text-ink">Page {{ pageNumber(f) }} · </span>{{ f.file.name }}
          </p>
          <AppCheckbox
            :model-value="f.included"
            label="Read this page"
            :disabled="busy"
            @update:model-value="edit(toggleFile(files, f.key))"
          />
          <div class="flex items-center justify-between">
            <div class="flex">
              <AppIconButton :icon="ChevronLeftIcon" size="sm" :label="`Move ${f.file.name} earlier`" :disabled="busy || i === 0" @click="edit(moveFile(files, i, -1))" />
              <AppIconButton :icon="ChevronRightIcon" size="sm" :label="`Move ${f.file.name} later`" :disabled="busy || i === files.length - 1" @click="edit(moveFile(files, i, 1))" />
            </div>
            <AppIconButton :icon="XMarkIcon" size="sm" :label="`Remove ${f.file.name}`" :disabled="busy" @click="edit(removeFile(files, f.key))" />
          </div>
        </li>
      </ol>

      <div v-if="files.length" class="flex flex-wrap items-center gap-3">
        <BaseButton variant="primary" :disabled="busy || pages.length === 0" data-testid="bol-read" @click="read">
          {{ pages.length === 1 ? "Read 1 page" : `Read ${pages.length} pages` }}
        </BaseButton>
        <p class="text-sm text-ink-secondary" aria-live="polite">{{ stageText }}</p>
      </div>

      <AppCallout v-if="outcome?.kind === 'done'" tone="success" data-testid="bol-outcome">
        Read {{ readPages.length }} {{ readPages.length === 1 ? "page" : "pages" }}; {{ bolPages }} taken as the bill of lading.
      </AppCallout>
      <AppCallout v-else-if="outcome?.kind === 'refused'" tone="danger" data-testid="bol-outcome">
        <div>
          <p>Nothing was read. Untick or replace these files, then read again:</p>
          <ul class="mt-1 list-disc pl-5 font-normal">
            <li v-for="r in outcome.files" :key="r.name">{{ r.name }} — {{ r.reason }}</li>
          </ul>
        </div>
      </AppCallout>
      <AppCallout v-else-if="outcome?.kind === 'failed'" tone="danger" data-testid="bol-outcome">{{ outcome.message }}</AppCallout>
    </div>
  </BaseCard>
</template>
