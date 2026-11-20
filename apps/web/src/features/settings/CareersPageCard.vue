<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { CAREERS_HANDLE_PATTERN, OPENING_UNPUBLISHED_TEXT, careersPageSaveSchema, type CareersPageSave } from "@silvicom/shared";
import { AppButton as BaseButton, AppCallout, AppFormField as FormField, AppInput as BaseInput, AppSwitch, QueryState } from "@silvicom/ui";
import StepUpPrompt from "@/components/StepUpPrompt.vue";
import { useStepUpRetry } from "@/composables/useStepUpRetry";
import { useCareersPage, useSaveCareersPage } from "@/features/settings/useCareersPage";
import { formatPhone } from "@/lib/format";
import { useToastStore } from "@/stores/toast";

/**
 * Settings › Recruiting › Careers page (APPLY-PAGE-PLAN AP1). Where a carrier sets up its public careers page: the
 * address (`/careers/<handle>`, the one link the company website points at), who an applicant asks for an
 * accommodation, and the switch. Built like the Tenstreet card beside it: a fresh sign-in before switching on,
 * never before switching off.
 *
 * ── WHICH OPENINGS ARE ON IT ────────────────────────────────────────────────────────────────────
 * Read from the server's one rule (`openingUnpublishedReason`, D-AP2): an open opening with a saved version and the
 * top of its pay range. Each one that is not on the page says why, in the sentence the Openings editor uses.
 *
 * ── THE ROBOT CHECK ─────────────────────────────────────────────────────────────────────────────
 * Until the server holds Turnstile's secret, applications are still taken and recorded as "not checked" (D-AP6);
 * the card says so, because the person who can fix it is reading it.
 */
const status = useCareersPage();
const save = useSaveCareersPage();
const toast = useToastStore();
const { stepUpFor, holdForStepUp, confirmed, cancel } = useStepUpRetry();

const handle = ref("");
const email = ref("");
const phone = ref("");
const errors = ref<Partial<Record<"handle" | "accommodationEmail" | "accommodationPhone", string>>>({});

const s = computed(() => status.data.value);
watch(
  s,
  (v) => {
    if (!v) return;
    handle.value = v.handle ?? "";
    email.value = v.accommodationEmail ?? "";
    phone.value = v.accommodationPhone ? formatPhone(v.accommodationPhone) : "";
  },
  { immediate: true },
);

const published = computed(() => (s.value?.openings ?? []).filter((o) => o.unpublished === null));
const unpublished = computed(() => (s.value?.openings ?? []).filter((o) => o.unpublished !== null));

/** Checked here with the server's own schema, so the card and the API refuse the same things in the same words. */
function input(enabled: boolean): CareersPageSave | null {
  const candidate = {
    handle: handle.value, // trimmed and lower-cased by the schema itself, as on the server
    enabled,
    accommodationEmail: email.value.trim() || null,
    accommodationPhone: phone.value.trim() || null,
  };
  const parsed = careersPageSaveSchema.safeParse(candidate);
  errors.value = {};
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof typeof errors.value;
    errors.value[key] ??= issue.message;
  }
  return null;
}

async function submit(enabled: boolean): Promise<void> {
  const body = input(enabled);
  if (!body) return;
  try {
    await save.mutateAsync(body);
    const was = s.value?.enabled ?? false;
    toast.success(enabled && !was ? "Careers page switched on" : !enabled && was ? "Careers page switched off" : "Careers page saved");
  } catch (e) {
    if (holdForStepUp(e, () => submit(enabled))) return;
    errors.value = { handle: e instanceof Error ? e.message : "Could not save" };
  }
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Link copied");
  } catch {
    toast.error("Could not copy", "Select the link and copy it manually.");
  }
}

const handleHint = computed(() => (CAREERS_HANDLE_PATTERN.test(handle.value.trim().toLowerCase()) ? `…/careers/${handle.value.trim().toLowerCase()}` : ""));
</script>

<template>
  <QueryState
    :loading="status.isLoading.value"
    :error="status.isError.value ? status.error.value : null"
    :retrying="status.isFetching.value"
    loading-text="Loading the careers page…"
    error-text="Could not load the careers page."
    @retry="status.refetch()"
  >
    <div v-if="stepUpFor">
      <StepUpPrompt :reason="stepUpFor" @confirmed="confirmed" @cancel="cancel" />
    </div>
    <div v-else-if="s" class="space-y-4">
      <AppCallout v-if="!s.robotCheckReady" tone="warning">
        The robot check is not set up on this server, so applications are taken and marked "not checked". Nothing is
        refused or lost.
      </AppCallout>

      <FormField v-slot="{ id }" label="Page address" :error="errors.handle" :hint="handleHint">
        <BaseInput :id="id" v-model="handle" autocomplete="off" spellcheck="false" :invalid="Boolean(errors.handle)" />
      </FormField>
      <div class="grid gap-4 sm:grid-cols-2">
        <FormField v-slot="{ id }" label="Accommodation requests: email" :error="errors.accommodationEmail">
          <BaseInput :id="id" v-model="email" type="email" autocomplete="off" :invalid="Boolean(errors.accommodationEmail)" />
        </FormField>
        <FormField v-slot="{ id }" label="Accommodation requests: phone" :error="errors.accommodationPhone">
          <BaseInput :id="id" v-model="phone" type="tel" autocomplete="off" :invalid="Boolean(errors.accommodationPhone)" />
        </FormField>
      </div>
      <p class="text-xs text-ink-muted">
        The page names this contact for applicants who need an accommodation to apply. At least one is needed before the
        page can be switched on.
      </p>
      <div class="flex justify-end">
        <BaseButton :disabled="save.isPending.value" @click="submit(s.enabled)">Save</BaseButton>
      </div>

      <div v-if="s.configured" class="space-y-2 border-t border-edge pt-4">
        <AppSwitch
          :model-value="s.enabled"
          label="Publish the careers page"
          :disabled="save.isPending.value"
          @update:model-value="(on: boolean) => submit(on)"
        />
        <p class="text-sm text-ink">
          {{ s.enabled ? "On — anyone with the link can see the published openings and apply." : "Off — the link shows nothing." }}
        </p>
        <div v-if="s.publicUrl" class="flex flex-wrap items-center gap-3">
          <p class="break-all font-mono text-xs text-ink">{{ s.publicUrl }}</p>
          <BaseButton size="sm" variant="secondary" @click="copy(s.publicUrl)">Copy the link</BaseButton>
        </div>
      </div>

      <div v-if="s.configured" class="space-y-2 border-t border-edge pt-4">
        <h3 class="text-sm font-semibold text-ink">Openings on the page</h3>
        <p v-if="published.length === 0" class="text-xs text-ink-muted">No opening is published yet.</p>
        <ul v-else class="space-y-1 text-sm text-ink">
          <li v-for="o in published" :key="o.id">{{ o.title }}</li>
        </ul>
        <template v-if="unpublished.length">
          <h3 class="pt-2 text-sm font-semibold text-ink">Not on the page</h3>
          <ul class="space-y-1 text-sm">
            <li v-for="o in unpublished" :key="o.id">
              <span class="text-ink">{{ o.title ?? "Untitled opening" }}</span>
              <span class="text-ink-muted"> — {{ OPENING_UNPUBLISHED_TEXT[o.unpublished!] }}</span>
            </li>
          </ul>
        </template>
      </div>
    </div>
  </QueryState>
</template>
