<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { ROAD_TEST_EXAMINER_SECTION } from "@silvicom/shared";
import SignatoryAddForm from "@/features/recruitment/SignatoryAddForm.vue";
import { hiringArtifactLink } from "@/features/recruitment/hiringArtifacts";
import { useSessionStore } from "@/stores/session";

/**
 * The road-test step with no examiner on file — a lawful state, not a dead end (owner, 2026-11-09,
 * Option 1: "We will add road-test managers later, maybe several, so this has to be optional").
 *
 * §391.51(b)(4) accepts a road test OR the §391.33 licence equivalency, and the hiring checklist already
 * counts either. With nobody to sign a certificate the step is done the second way: the equivalency,
 * recorded with a copy of the licence in the qualification file (the road-test row's second evidence,
 * which `RequirementDrawer` records since the same day). So this names that route and links there for a
 * role that writes the file (`roster: manage`, the compliance routes' gate), and tells anybody else who
 * records it.
 *
 * Adding an examiner is offered to the admin as a choice. Until 2026-11-09 it was a form the admin could
 * not dismiss, which read as the only way through the step.
 */
/**
 * ⚠ `onAdded` is a PROP, for `SignatoryAddForm`'s reason: the examiners query refetches when the add
 * succeeds, this component unmounts as soon as one is on file, and Vue drops an emit from an unmounted
 * component. The parent still writes `@added`.
 */
const props = defineProps<{ driverId: string; onAdded?: (examiner: { id: string }) => void }>();

const session = useSessionStore();
const canAddExaminer = computed(() => session.can(ROAD_TEST_EXAMINER_SECTION));
const canWriteFile = computed(() => session.can("roster"));
const fileLink = computed(() => hiringArtifactLink("qualification_records.road_test", props.driverId).to);
const adding = ref(false);

function added(examiner: { id: string }): void {
  adding.value = false;
  props.onAdded?.(examiner);
}
</script>

<template>
  <div class="space-y-3" data-testid="no-examiner">
    <p class="text-xs text-ink-secondary">
      No road-test examiner is on file. To accept their CDL instead of a road test (§391.33), record the licence
      equivalency with a copy of the licence in the qualification file.
    </p>
    <BaseButton v-if="canWriteFile && fileLink" :to="fileLink" size="sm" data-testid="open-file">
      Open the qualification file
    </BaseButton>
    <p v-else class="text-xs text-ink-muted" data-testid="ask-file-keeper">
      Ask a safety manager or an administrator to record it there.
    </p>
    <template v-if="canAddExaminer">
      <SignatoryAddForm v-if="adding" kind="examiner" cancellable :on-added="added" @cancel="adding = false" />
      <BaseButton v-else variant="link" size="sm" data-testid="add-examiner" @click="adding = true">
        Or add a road-test examiner
      </BaseButton>
    </template>
  </div>
</template>
