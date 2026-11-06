<script setup lang="ts">
import { computed, ref } from "vue";
import { hiringProfileSaveSchema } from "@silvicom/shared";
import { AppButton as BaseButton, AppCallout, AppFormField as FormField, AppInput as BaseInput, AppSelect, FactList, QueryState } from "@silvicom/ui";
import { useToastStore } from "@/stores/toast";
import { profileOptions, requirementFacts } from "./hiringProfileStep";
import { useHiringProfilesQuery, useSaveHiringProfile } from "./useOpenings";

/**
 * Which hiring profile the opening's leads are sorted against (Q-AD44 (a); `hiringProfileStep.ts` says why it is
 * shaped this way). With no profile yet, the owner's v1 defaults are shown read-only and a PERSON saves them as
 * the first profile — nothing seeds one (0553 header).
 */
const model = defineModel<string>({ required: true });
defineProps<{ canManage: boolean }>();

const toast = useToastStore();
const list = useHiringProfilesQuery();
const save = useSaveHiringProfile();
const options = computed(() => profileOptions(list.data.value?.profiles ?? []));
const name = ref("");
const refusal = ref<string | null>(null);

async function saveFirst(): Promise<void> {
  const defaults = list.data.value?.defaults;
  if (!defaults) return;
  const parsed = hiringProfileSaveSchema.safeParse({ profile_id: null, name: name.value, requirements: defaults });
  if (!parsed.success) {
    refusal.value = `Profile name: ${parsed.error.issues[0]!.message}`;
    return;
  }
  refusal.value = null;
  try {
    const saved = await save.mutateAsync(parsed.data);
    model.value = saved.version_id;
    toast.success("Hiring profile saved");
  } catch (e) {
    toast.error("Could not save the hiring profile", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <fieldset class="space-y-3" data-test="profile-step">
    <legend class="text-sm font-semibold text-ink">Hiring profile</legend>
    <QueryState :loading="list.isLoading.value" :error="list.error.value" error-text="Could not load the hiring profiles." loading-text="Loading the hiring profiles…" compact :retrying="list.isFetching.value" @retry="list.refetch()">
      <FormField v-if="options.length" v-slot="{ id }" label="Who qualifies" hint="Leads from this opening are sorted against this profile." required>
        <AppSelect :id="id" v-model="model" :options="options" placeholder="Pick a hiring profile" data-test="profile-select" />
      </FormField>
      <div v-else-if="list.data.value" class="space-y-3">
        <p class="text-sm text-ink-muted" data-test="no-profile">
          No hiring profile yet. These are the owner's starting requirements. Read them, name the profile, and save it.
        </p>
        <FactList :facts="requirementFacts(list.data.value.defaults)" layout="rows" data-test="profile-defaults" />
        <template v-if="canManage">
          <FormField v-slot="{ id }" label="Profile name" required>
            <BaseInput :id="id" v-model="name" placeholder="Class A regional" data-test="profile-name" />
          </FormField>
          <AppCallout v-if="refusal" tone="danger" data-test="profile-refusal">{{ refusal }}</AppCallout>
          <BaseButton :disabled="save.isPending.value" data-test="save-first-profile" @click="saveFirst">Save as the first hiring profile</BaseButton>
        </template>
        <p v-else class="text-sm text-ink-muted">Someone who manages recruiting saves the first profile.</p>
      </div>
    </QueryState>
  </fieldset>
</template>
