<script setup lang="ts">
import { computed, ref } from "vue";
import { formatDisplayDate } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import SignatoryAddForm from "@/features/recruitment/SignatoryAddForm.vue";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useDeleteRepresentative, useRepresentatives } from "@/features/recruitment/useHandbook";
import { useRetireRoadTestExaminer, useRoadTestExaminers } from "@/features/recruitment/useRoadTest";

/**
 * The people who sign for the carrier, of one kind — listed, added, and taken off (Q-AW42).
 *
 * ── WHO MAY CHANGE IT ─────────────────────────────────────────────────────────────────────────
 * `session.can("recruitment")`, the matrix's `manage`, which is exactly what the api's POST, DELETE and
 * retire routes ask (`requireSection("recruitment")`). Not `session.admin`: a recruiter holds
 * `recruitment: manage` in the shipped matrix and is the person who needs a Representative on file
 * before they can countersign a handbook. A caller with `view` sees the list and no buttons, so the
 * page never offers an act the server would refuse.
 *
 * ── TAKING SOMEBODY OFF IS TWO DIFFERENT ACTS, AND THE KIND DECIDES WHICH ─────────────────────
 * A Representative is REMOVED (DELETE). One who has countersigned a handbook cannot be, and the api's
 * sentence (409 `has_signed`) is the one the toast shows — no count is fetched here to grey the
 * button, the same reasoning as the inspector register's. An examiner is RETIRED: the forms and
 * certificates they signed read their signature from the row, so the api keeps it and stamps
 * `retired_at`, and the list (which only returns examiners who may sign today) drops them. Neither
 * can be undone from the product, so both ask first.
 */
type Kind = "representative" | "examiner";
const props = defineProps<{ kind: Kind }>();
const emit = defineEmits<{ added: [person: { id: string; full_name: string }]; removed: [id: string] }>();

const session = useSessionStore();
const toast = useToastStore();
const canManage = computed(() => session.can("recruitment"));

const listQ = props.kind === "representative" ? useRepresentatives() : useRoadTestExaminers();
const takeOff = props.kind === "representative" ? useDeleteRepresentative() : useRetireRoadTestExaminer();
const people = computed(() => listQ.data.value ?? []);

const COPY: Record<Kind, { empty: string; add: string; act: string; ask: (name: string) => string; done: string; failed: string }> = {
  representative: {
    empty: "Nobody signs for the carrier yet. Add a representative to countersign handbooks.",
    add: "Add a representative",
    act: "Remove",
    ask: (name) =>
      `Remove ${name}? Anybody who has countersigned a handbook stays on file, and you will be told so.`,
    done: "Representative removed",
    failed: "Could not remove the representative",
  },
  examiner: {
    empty: "No examiner is on file yet. Add one to record a road test.",
    add: "Add an examiner",
    act: "Retire",
    ask: (name) =>
      `Retire ${name}? They can no longer give a road test. The road tests they already signed keep their signature.`,
    done: "Examiner retired",
    failed: "Could not retire the examiner",
  },
};
const copy = computed(() => COPY[props.kind]);

const adding = ref(false);
function onAdded(person: { id: string; full_name: string }): void {
  adding.value = false;
  emit("added", person);
}

async function takeOffList(id: string, name: string): Promise<void> {
  if (!confirm(copy.value.ask(name))) return;
  try {
    await takeOff.mutateAsync(id);
    toast.success(copy.value.done, `${name} is no longer on the list.`);
    emit("removed", id);
  } catch (e) {
    toast.error(copy.value.failed, e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-3">
    <p v-if="listQ.isLoading.value" class="text-xs text-ink-muted">Loading…</p>
    <p v-else-if="listQ.isError.value" class="text-xs text-danger-700">
      {{ listQ.error.value?.message ?? "Could not load the list." }}
    </p>
    <p v-else-if="people.length === 0" class="text-xs text-ink-muted">{{ copy.empty }}</p>
    <ul v-else class="divide-y divide-edge border-y border-edge">
      <li v-for="person in people" :key="person.id" class="flex items-center justify-between gap-3 py-2 text-xs">
        <span class="text-ink">
          {{ person.full_name }} <span class="text-ink-secondary">· {{ person.title }}</span>
          <span class="text-ink-muted"> · added {{ formatDisplayDate(person.created_at, "") }}</span>
        </span>
        <BaseButton
          v-if="canManage"
          variant="ghost"
          size="sm"
          :disabled="takeOff.isPending.value"
          @click="takeOffList(person.id, person.full_name)"
        >
          {{ copy.act }}
        </BaseButton>
      </li>
    </ul>

    <template v-if="canManage && !listQ.isLoading.value && !listQ.isError.value">
      <SignatoryAddForm
        v-if="people.length === 0 || adding"
        :kind="kind"
        :cancellable="people.length > 0"
        @added="onAdded"
        @cancel="adding = false"
      />
      <BaseButton v-else variant="link" size="sm" @click="adding = true">{{ copy.add }}</BaseButton>
    </template>
  </div>
</template>
