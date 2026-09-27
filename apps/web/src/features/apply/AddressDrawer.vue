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
import { isCurrentAddress } from "@/features/apply/partOneFacts";

type StreetOnly = Pick<DraftAddress, "line1" | "line2" | "city" | "state" | "postal_code">;
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
const props = defineProps<{
  open: boolean;
  index: number;
  address: DraftAddress | null;
  /**
   * Part 1's street, on a v2 link whose facts are released (C3c2c2, Q-AW34) — `partOneStreet`, the street
   * filing lays over the CURRENT address. While this address is the current one (no end month) the
   * street is that one, shown and not asked, and only the months are the driver's to give.
   */
  currentStreet?: StreetOnly | null;
}>();
const emit = defineEmits<{ save: [DraftAddress]; remove: []; close: [] }>();

const copy = APPLY_COPY.addresses;

const local = ref<DraftAddress>(emptyAddress());
/** Composition's test, on the address as it stands in the panel: blanking "Until" makes it the current one. */
const streetLocked = computed(() => Boolean(props.currentStreet) && isCurrentAddress(local.value));
/** The address as it would be saved — with Part 1's street while it is the current one. */
const asSaved = (): DraftAddress => ({ ...local.value, ...(streetLocked.value ? props.currentStreet! : {}) });
const shownStreet = computed(() => {
  const s = props.currentStreet;
  return s ? [s.line1, s.line2, `${s.city}, ${s.state} ${s.postal_code}`].filter((p) => p.trim() !== "").join("\n") : "";
});
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
  const candidate = toAddressPayload(asSaved());
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
  emit("save", asSaved());
}
</script>

<template>
  <SlideOver :open="open" :title="title" :description="copy.drawerIntro" size="lg" @close="emit('close')">
    <div v-if="open" class="space-y-4">
      <div v-if="streetLocked" class="space-y-1 rounded-surface bg-surface-muted p-4" data-current-street>
        <p class="text-xs text-ink-muted">{{ APPLY_COPY.partOneFacts.currentAddress }}</p>
        <p class="whitespace-pre-line text-sm text-ink">{{ shownStreet }}</p>
        <p class="text-xs text-ink-muted">{{ APPLY_COPY.partOneFacts.currentAddressNote }}</p>
      </div>
      <AddressFields v-model="local" :index="index" :street-locked="streetLocked" />
    </div>

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
