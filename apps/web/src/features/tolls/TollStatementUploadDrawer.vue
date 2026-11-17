<script setup lang="ts">
import { computed, ref } from "vue";
import { TOLL_PROVIDERS, TOLL_PROVIDER_LABEL, TOLL_STATEMENT_ACCEPT, type TollProvider } from "@silvicom/shared";
import { AppBadge, AppButton, AppFormField, AppSelect } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import { TollStatementRefused, useUploadTollStatement } from "./useTollStatements";
import { fileSize } from "./tollStatementRows";

/**
 * Upload toll statements (TOLLS-PER-TRUCK-PLAN.md TL4a): pick the provider, drop one file or a
 * season's worth. A drawer, as every upload in the product is (D-FUI3), opened from the page header
 * behind `session.can("accounting")` — the API's writes are `requireSection("accounting")`.
 *
 * ── THE PROVIDER IS CHOSEN, NEVER GUESSED ────────────────────────────────────────────────────
 * Nothing is read from a file yet (TL5 reads them), so the file cannot say whose it is. The person
 * holding it can. So the list of files waits for a provider, and there is no default: a default would
 * file a stack of K-TAG statements under E-ZPass for whoever did not look.
 *
 * Files go up one after another, each with its own outcome on its own line, so one refused file
 * (a copy already kept, a photo named `.pdf`) never takes the rest of the stack with it.
 */
defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

type Outcome = "waiting" | "sending" | "kept" | "duplicate" | "refused";
interface Row { key: string; name: string; size: number; provider: TollProvider; outcome: Outcome; message: string | null }

const upload = useUploadTollStatement();
const provider = ref<TollProvider | "">("");
const rows = ref<Row[]>([]);
const busy = computed(() => rows.value.some((r) => r.outcome === "waiting" || r.outcome === "sending"));
const keptCount = computed(() => rows.value.filter((r) => r.outcome === "kept").length);

const providerOptions = [
  { value: "", label: "Choose the provider…" },
  ...TOLL_PROVIDERS.map((p) => ({ value: p, label: TOLL_PROVIDER_LABEL[p] })),
];

const OUTCOME: Record<Outcome, { label: string; tone: "neutral" | "info" | "success" | "caution" | "danger" }> = {
  waiting: { label: "Waiting", tone: "neutral" },
  sending: { label: "Uploading…", tone: "info" },
  kept: { label: "Uploaded", tone: "success" },
  duplicate: { label: "Already on the list", tone: "caution" },
  refused: { label: "Not uploaded", tone: "danger" },
};

let seq = 0;
async function onFiles(files: File[]) {
  const p = provider.value;
  if (!p) return;
  const queued = files.map((f) => ({ file: f, row: { key: `${++seq}`, name: f.name, size: f.size, provider: p, outcome: "waiting" as Outcome, message: null } }));
  rows.value = [...queued.map((q) => q.row), ...rows.value];
  for (const q of queued) {
    const row = rows.value.find((r) => r.key === q.row.key)!;
    row.outcome = "sending";
    try {
      await upload.mutateAsync({ provider: p, file: q.file });
      row.outcome = "kept";
    } catch (e) {
      row.outcome = e instanceof TollStatementRefused && e.code === "already_uploaded" ? "duplicate" : "refused";
      row.message = e instanceof Error ? e.message : "Could not upload this file. Try it again.";
    }
  }
}

/** Closing clears the list, unless files are still going up: reopened, it shows the stack finishing. */
function close() {
  if (!busy.value) {
    rows.value = [];
    provider.value = "";
  }
  emit("close");
}
</script>

<template>
  <SlideOver
    :open="open"
    size="lg"
    title="Upload toll statements"
    description="The statements E-ZPass, K-TAG and ExpressToll send. Each file is kept exactly as it is; the tolls inside are read from it later."
    @close="close"
  >
    <div class="space-y-6">
      <AppFormField v-slot="{ id }" label="Provider" hint="Whose statements these are. Upload each provider's files separately." required>
        <AppSelect :id="id" v-model="provider" :options="providerOptions" :disabled="busy" data-test="statement-provider" />
      </AppFormField>

      <FileDropzone
        :accept="TOLL_STATEMENT_ACCEPT"
        multiple
        :disabled="!provider"
        :busy="busy"
        busy-label="Uploading…"
        :label="provider ? `Drop the ${TOLL_PROVIDER_LABEL[provider]} statements here` : 'Choose the provider first'"
        hint="PDF, CSV, Excel (.xlsx or .xls) or OpenDocument (.ods), up to 25 MB each. Several files at once is fine."
        @files="onFiles"
      />

      <section v-if="rows.length" aria-labelledby="statement-upload-results" class="space-y-2">
        <h3 id="statement-upload-results" class="text-sm font-semibold text-ink">This upload</h3>
        <ul class="divide-y divide-edge-subtle rounded-surface ring-1 ring-inset ring-edge" data-test="statement-upload-rows">
          <li v-for="r in rows" :key="r.key" class="flex items-start justify-between gap-3 px-3 py-2" data-test="statement-upload-row">
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-ink">{{ r.name }}</p>
              <p class="text-xs text-ink-tertiary">{{ TOLL_PROVIDER_LABEL[r.provider] }} · {{ fileSize(r.size) }}</p>
              <p v-if="r.message" class="mt-1 text-xs text-ink-secondary" data-test="statement-upload-message">{{ r.message }}</p>
            </div>
            <AppBadge :tone="OUTCOME[r.outcome].tone" class="shrink-0">{{ OUTCOME[r.outcome].label }}</AppBadge>
          </li>
        </ul>
        <p v-if="!busy && keptCount" class="text-xs text-ink-tertiary" data-test="statement-upload-summary">
          {{ keptCount }} {{ keptCount === 1 ? "file is" : "files are" }} on the list. Nothing needs uploading again when the tolls are read.
        </p>
      </section>
    </div>
    <template #footer>
      <AppButton variant="primary" :disabled="busy" data-test="statement-upload-done" @click="close">{{ busy ? "Uploading…" : "Done" }}</AppButton>
    </template>
  </SlideOver>
</template>
