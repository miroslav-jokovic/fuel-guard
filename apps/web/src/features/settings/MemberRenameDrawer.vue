<script setup lang="ts">
import { ref, watch } from "vue";
import type { OrgMember } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { apiRefusal, useStepUpRetry } from "@/composables/useStepUpRetry";
import { AppButton as BaseButton, AppFormField as FormField, AppInput as BaseInput } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import StepUpPrompt from "@/components/StepUpPrompt.vue";
import { useToastStore } from "@/stores/toast";

/**
 * "Edit name" / "Add name" on the Users page (0301). A drawer rather than an inline cell: a name is
 * typed once and confirmed, not toggled, and the drawer can say what the roster does for a driver
 * (D-MEM3) where a cell could not.
 *
 * Moved out of SettingsUsersPage.vue for SP9 (Q-SET8 (a), 2026-09-30), which put a rename behind the
 * password step-up with every other write on that page — `PATCH /api/members/:id` is one route for a
 * re-role and a rename, and members.ts says why it does not read the body to decide. Owning its own
 * prompt is MemberPasswordResetDrawer's pattern: the prompt replaces the drawer body and the save
 * re-runs once the password is given, where a second drawer opened beside this one would be two
 * dialogs both owning Escape. It also kept the page inside its 500-line budget.
 */
const props = defineProps<{ member: OrgMember | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const toast = useToastStore();
const name = ref("");
const busy = ref(false);
const { stepUpFor, holdForStepUp, confirmed, cancel } = useStepUpRetry();

watch(
  () => props.member,
  (m) => {
    name.value = m?.fullName ?? "";
  },
  { immediate: true },
);

async function save(): Promise<void> {
  const m = props.member;
  const typed = name.value.trim();
  if (!m || typed.length === 0) return;
  busy.value = true;
  try {
    const res = await apiFetch(`/api/members/${m.userId}`, { method: "PATCH", body: { fullName: typed } });
    if (!res.ok) throw apiRefusal(res.error, "Could not update name");
    toast.success("Name updated", `${m.email ?? m.userId} is now ${typed}`);
    emit("saved");
  } catch (e) {
    if (holdForStepUp(e, save)) return;
    toast.error("Could not update name", e instanceof Error ? e.message : undefined);
  } finally {
    busy.value = false;
  }
}

function close(): void {
  cancel();
  emit("close");
}
</script>

<template>
  <SlideOver
    :open="member !== null"
    :title="member?.fullName ? 'Edit name' : 'Add name'"
    :description="member?.email ?? undefined"
    @close="close"
  >
    <StepUpPrompt v-if="stepUpFor" :reason="stepUpFor" @confirmed="confirmed" @cancel="cancel" />
    <form v-else id="rename-member" class="space-y-4" @submit.prevent="save">
      <FormField
        v-slot="{ id }"
        label="Name"
        :hint="member?.role === 'driver' ? 'A driver is named by the roster until you set a name here; the roster row itself is edited on the Drivers page.' : 'How this person appears across Silvicom 360.'"
      >
        <BaseInput :id="id" v-model="name" type="text" required maxlength="120" autocomplete="off" />
      </FormField>
    </form>
    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton :disabled="busy" @click="close">Cancel</BaseButton>
        <BaseButton
          variant="primary"
          type="submit"
          form="rename-member"
          :disabled="busy || stepUpFor !== null || name.trim().length === 0"
        >
          {{ busy ? "Saving…" : "Save name" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
