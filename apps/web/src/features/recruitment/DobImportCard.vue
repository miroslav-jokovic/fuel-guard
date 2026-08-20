<script setup lang="ts">
import { computed, ref } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { DOB_REJECT_LABELS, type DobImportPlan } from "@fuelguard/shared";
import { AppButton as BaseButton, AppCard as BaseCard } from "@fuelguard/ui";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { apiFetch } from "@/lib/api";
import { useToastStore } from "@/stores/toast";
import { screeningReadinessKey } from "@/features/recruitment/useScreeningReadiness";

/**
 * Importing dates of birth from a spreadsheet (P0b).
 *
 * ── DRY RUN FIRST, ALWAYS ──────────────────────────────────────────────────────────────────────
 * Dropping the file previews it; a second, explicit press applies it. The preview is not decoration:
 * the matching rules refuse ambiguous names and never overwrite, and the only way somebody can trust
 * those rules is to see what they decided about THEIR file before anything is written. A one-click
 * import would make "it matched 43 of 201, and here is why" a post-mortem instead of a decision.
 *
 * Both passes are computed by the SERVER, from the file, against the live roster — the browser never
 * resolves a name to a driver id and sends that. Matching is where the safety rules live.
 */
const toast = useToastStore();
const qc = useQueryClient();

const file = ref<File | null>(null);
const csv = ref<string | null>(null);
const plan = ref<(DobImportPlan & { applied: number }) | null>(null);
const busy = ref(false);
const applied = ref(false);

async function send(dryRun: boolean): Promise<void> {
  if (!csv.value) return;
  busy.value = true;
  try {
    const res = await apiFetch<DobImportPlan & { applied: number }>(
      "/api/recruitment/screening-readiness/dob-import",
      { method: "POST", body: { csv: csv.value, dryRun } },
    );
    if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not read the file.");
    plan.value = res.data;
    if (!dryRun) {
      applied.value = true;
      toast.success(`${res.data.applied} dates of birth imported`);
      void qc.invalidateQueries({ queryKey: screeningReadinessKey });
    }
  } catch (e) {
    toast.error("Could not import the file", e instanceof Error ? e.message : undefined);
  } finally {
    busy.value = false;
  }
}

async function chooseFile(files: File[]): Promise<void> {
  const chosen = files[0] ?? null;
  file.value = chosen;
  plan.value = null;
  applied.value = false;
  csv.value = chosen ? await chosen.text() : null;
  if (csv.value) await send(true);
}

function reset(): void {
  file.value = null;
  csv.value = null;
  plan.value = null;
  applied.value = false;
}

/** Rejections grouped by reason — 140 identical lines is a wall, four counts is an instruction. */
const rejectGroups = computed(() => {
  const groups = new Map<string, { reason: string; count: number; example: string | null }>();
  for (const reject of plan.value?.rejects ?? []) {
    const existing = groups.get(reject.reason);
    if (existing) existing.count += 1;
    else groups.set(reject.reason, { reason: reject.reason, count: 1, example: reject.detail ?? reject.label });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
});
</script>

<template>
  <BaseCard>
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h3 class="text-sm font-semibold text-ink">Import dates of birth</h3>
        <p class="mt-1 text-sm text-ink-muted">
          A spreadsheet with a <span class="font-mono text-xs">date_of_birth</span> column and a name,
          employee number, licence number or driver id to match on. Dates must be written as
          <span class="font-mono text-xs">YYYY-MM-DD</span> — nothing here guesses between 03/04 and
          04/03. A date already on file is never overwritten.
        </p>
      </div>
      <BaseButton to="/api/recruitment/screening-readiness/template.csv" target="_blank">
        Download the template
      </BaseButton>
    </div>

    <div class="mt-4">
      <FileDropzone
        accept=".csv"
        :busy="busy"
        busy-label="Reading…"
        :label="file ? file.name : 'Drag & drop the spreadsheet here'"
        hint="CSV. Nothing is written until you press Import."
        @files="chooseFile"
      />
    </div>

    <div v-if="plan" class="mt-4 space-y-4">
      <div v-if="plan.errors.length" class="rounded-surface bg-surface-muted p-3">
        <p v-for="error in plan.errors" :key="error" class="text-sm text-ink">{{ error }}</p>
      </div>

      <template v-else>
        <dl class="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div class="rounded-surface bg-surface-muted p-3">
            <dt class="text-xs font-medium text-ink-secondary">Matched</dt>
            <dd class="mt-1 text-lg font-bold text-ink">{{ plan.matches.length }}</dd>
          </div>
          <div class="rounded-surface bg-surface-muted p-3">
            <dt class="text-xs font-medium text-ink-secondary">Not imported</dt>
            <dd class="mt-1 text-lg font-bold text-ink">{{ plan.rejects.length }}</dd>
          </div>
          <div v-if="applied" class="rounded-surface bg-surface-muted p-3">
            <dt class="text-xs font-medium text-ink-secondary">Written</dt>
            <dd class="mt-1 text-lg font-bold text-ink">{{ plan.applied }}</dd>
          </div>
        </dl>

        <ul v-if="rejectGroups.length" class="space-y-1 text-sm">
          <li v-for="group in rejectGroups" :key="group.reason" class="text-ink-secondary">
            <span :class="[BADGE_BASE, toneClass('warning')]">{{ group.count }}</span>
            <span class="ml-2">{{ DOB_REJECT_LABELS[group.reason as keyof typeof DOB_REJECT_LABELS] }}</span>
            <span v-if="group.example" class="ml-1 text-ink-muted">— e.g. {{ group.example }}</span>
          </li>
        </ul>

        <div class="flex items-center justify-end gap-3">
          <BaseButton :disabled="busy" @click="reset">Start again</BaseButton>
          <BaseButton
            v-if="!applied"
            variant="primary"
            :disabled="busy || plan.matches.length === 0"
            @click="send(false)"
          >
            {{ busy ? "Importing…" : `Import ${plan.matches.length} dates of birth` }}
          </BaseButton>
        </div>
      </template>
    </div>
  </BaseCard>
</template>
