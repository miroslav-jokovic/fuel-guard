<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { applicationAddressSchema } from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import AddressFields from "@/features/apply/AddressFields.vue";
import { provideApplyIssues } from "@/features/apply/issues";
import { describeField, fieldId, messageFor, valueAt } from "@/features/apply/fieldLabels";
import type { SectionIssue } from "@/features/apply/useApplicationWizard";
import { emptyAddress, toAddressPayload, type DraftAddress } from "@/features/apply/draft";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * One address, on its own — §6.4 item 2's "one address per screen" on a v2 link (C3c2c1).
 *
 * The address screen's add-another loop, built the way the job loop already was (`EmployerDrawer`):
 * the list is the hub, this panel is the page, and the same three rules hold for the same reasons —
 * it EDITS A COPY (Cancel changes nothing, and an abandoned edit is never autosaved); it CHECKS ITSELF
 * on Save against `applicationAddressSchema`, the server's own row schema, with the paths rebased onto
 * the document so the label, id and sentence are the page's; and its issues are `provide`d into this
 * subtree so `ApplyField` finds the panel's errors, not the page's.
 *
 * The three years (`addressCoverage`) are the screen's, not the panel's: whether a month is covered is
 * a question about the whole list, and the meter beside it answers it.
 */
const props = defineProps<{ open: boolean; index: number; address: DraftAddress | null }>();
const emit = defineEmits<{ save: [DraftAddress]; remove: []; close: [] }>();

const copy = APPLY_COPY.addresses;

const local = ref<DraftAddress>(emptyAddress());
const issues = ref<SectionIssue[]>([]);
provideApplyIssues(issues);

watch(
  () => [props.open, props.index] as const,
  ([open]) => {
    if (!open) return;
    local.value = { ...(props.address ?? emptyAddress()) };
    issues.value = [];
  },
  { immediate: true },
);

/** A row `toApplication` would file — the list's own test — so only a real address can be removed. */
const savedAlready = computed(() => Boolean(props.address && (props.address.line1.trim() || props.address.city.trim())));
const title = computed(() => (savedAlready.value ? props.address!.line1.trim() || props.address!.city.trim() : copy.drawerNew));

function save(): void {
  const candidate = toAddressPayload(local.value);
  const parsed = applicationAddressSchema.safeParse(candidate);
  if (!parsed.success) {
    issues.value = parsed.error.issues.map((issue) => {
      const field = issue.path as (string | number)[];
      const path = ["addresses", props.index, ...field];
      return {
        path,
        key: "addresses",
        message: issue.message,
        label: describeField(path),
        say: messageFor({ ...issue, path }, valueAt(candidate, field)),
        fieldId: fieldId(path),
        section: "addresses" as const,
      };
    });
    const first = globalThis.document?.getElementById(issues.value[0]!.fieldId);
    first?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    first?.focus?.();
    return;
  }
  emit("save", { ...local.value });
}
</script>

<template>
  <SlideOver :open="open" :title="title" :description="copy.drawerIntro" size="lg" @close="emit('close')">
    <AddressFields v-if="open" v-model="local" :index="index" />

    <template #footer>
      <!-- Remove in the panel, away from Change — `EmployerDrawer`'s reason: the two are not equally undoable. -->
      <div class="flex flex-wrap items-center justify-between gap-3">
        <BaseButton v-if="savedAlready" variant="ghost" size="touch" @click="emit('remove')">{{ copy.remove }}</BaseButton>
        <span v-else />
        <div class="flex items-center gap-3">
          <BaseButton variant="secondary" size="touch" @click="emit('close')">{{ copy.drawerCancel }}</BaseButton>
          <BaseButton variant="primary" size="touch" @click="save">{{ copy.drawerSave }}</BaseButton>
        </div>
      </div>
    </template>
  </SlideOver>
</template>
