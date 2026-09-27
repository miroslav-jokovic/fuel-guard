<script setup lang="ts">
import { AppButton as BaseButton } from "@silvicom/ui";
import { computed, ref } from "vue";
import { addressCoverage, formatDisplayMonth, type ApplicationAddress } from "@silvicom/shared";
import { emptyAddress, toApplication, type ApplicationDraft, type DraftAddress } from "@/features/apply/draft";
import AddressFields from "@/features/apply/AddressFields.vue";
import AddressDrawer from "@/features/apply/AddressDrawer.vue";
import { useApplyIssues } from "@/features/apply/issues";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * §391.21(b)(3) — every address for the three years preceding the application.
 *
 * C3c1: with the months the list does not yet cover, from `addressCoverage` — the arithmetic a v2 filing
 * refuses on (`applicationV2FilingIssues`), over the addresses as they would be FILED (`toApplication`
 * drops a row with no street and no city), so this list and that refusal cannot disagree.
 *
 * C3c2c1 (§6.4 item 2): on a v2 link, one address per screen — a list of the addresses with a panel per
 * address (`AddressDrawer`), the shape the job loop has had since X5, with the meter kept beside the
 * list. A legacy link keeps its inline cards: its linear wizard is not being redesigned, and nothing its
 * filing asks changed. Both render the same boxes (`AddressFields`).
 *
 * ZIP → city and state (§6.4's other half) is NOT here: Q-AW10's default is a static ZIP table, and
 * none is in the repository — sourcing one is its own piece of work, not a line in this screen.
 */
const props = withDefaults(
  defineProps<{
    /** The application's day on the carrier's clock (`carrierToday`), the one filing measures from. */
    asOf: string;
    /** That day on a v2 link, null on a legacy one — which of the two screens this is (C3c2c1). */
    v2AsOf?: string | null;
  }>(),
  { v2AsOf: null },
);
const draft = defineModel<ApplicationDraft>({ required: true });
const copy = APPLY_COPY.addresses;
const { hasIssueWithin, idFor } = useApplyIssues();

const coverage = computed(() =>
  addressCoverage((toApplication(draft.value) as { addresses: ApplicationAddress[] }).addresses, props.asOf),
);

// ── the v2 loop ─────────────────────────────────────────────────────────────────────────────────

const editing = ref<number | null>(null);

/** `toApplication`'s own test for a row worth filing — a blank row is not an address the driver gave. */
const filled = (a: DraftAddress): boolean => a.line1.trim() !== "" || a.city.trim() !== "";
const rows = computed(() =>
  draft.value.addresses
    .map((address, index) => ({ address, index }))
    .filter((row) => filled(row.address) || row.index === editing.value),
);

const period = (a: DraftAddress): string =>
  a.from ? `${formatDisplayMonth(a.from)} — ${a.to.trim() === "" ? copy.toNow : formatDisplayMonth(a.to)}` : copy.noDates;
const place = (a: DraftAddress): string => [a.line1.trim(), a.city.trim(), a.state.trim()].filter(Boolean).join(", ");

/** A new address reuses the empty draft's blank row when there is one, rather than stacking a second. */
function add(): void {
  const blank = draft.value.addresses.findIndex((a) => !filled(a));
  if (blank >= 0) {
    editing.value = blank;
    return;
  }
  draft.value.addresses = [...draft.value.addresses, emptyAddress()];
  editing.value = draft.value.addresses.length - 1;
}

function save(address: DraftAddress): void {
  const at = editing.value;
  if (at === null) return;
  draft.value.addresses = draft.value.addresses.map((row, i) => (i === at ? address : row));
  editing.value = null;
}

/**
 * Removing an address never leaves the list without a row: `emptyDraft` starts with one blank address,
 * and `fromDraftPayload` floors an empty list back to it, so an empty array is a state no reload keeps.
 */
function remove(): void {
  const at = editing.value;
  if (at === null) return;
  const left = draft.value.addresses.filter((_, i) => i !== at);
  draft.value.addresses = left.length > 0 ? left : [emptyAddress()];
  editing.value = null;
}
</script>

<template>
  <section class="space-y-4">
    <p class="text-sm text-ink-muted">{{ copy.intro }}</p>

    <div v-if="v2AsOf" class="space-y-3">
      <h3 class="text-sm font-semibold text-ink">{{ copy.listHeading }}</h3>
      <ul v-if="rows.length" class="space-y-2">
        <li
          v-for="row in rows"
          :key="row.index"
          class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-surface bg-surface-muted p-3"
        >
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-ink">{{ place(row.address) }}</p>
            <p class="text-xs text-ink-muted">{{ period(row.address) }}</p>
            <p v-if="hasIssueWithin(['addresses', row.index])" class="mt-1 text-sm text-danger-700">
              {{ copy.needsAnswers }}
            </p>
          </div>
          <BaseButton variant="ghost" size="touch" @click="editing = row.index">{{ copy.change }}</BaseButton>
        </li>
      </ul>
      <BaseButton :variant="rows.length ? 'secondary' : 'primary'" size="touch" @click="add">
        {{ rows.length ? copy.add : copy.addFirst }}
      </BaseButton>
      <AddressDrawer
        :open="editing !== null"
        :index="editing ?? 0"
        :address="editing === null ? null : (draft.addresses[editing] ?? null)"
        @save="save"
        @remove="remove"
        @close="editing = null"
      />
    </div>

    <template v-else>
      <div
        v-for="(_, i) in draft.addresses"
        :key="i"
        class="space-y-4 rounded-surface bg-surface-muted p-4"
      >
        <AddressFields v-model="draft.addresses[i]!" :index="i" />
        <div v-if="draft.addresses.length > 1" class="flex justify-end">
          <BaseButton variant="ghost" size="sm" @click="draft.addresses.splice(i, 1)">{{ copy.remove }}</BaseButton>
        </div>
      </div>

      <BaseButton @click="draft.addresses.push(emptyAddress())">{{ copy.add }}</BaseButton>
    </template>

    <!-- `addresses` is the path a v2 filing's (b)(3) refusal carries, so its message lands — and focus
         moves — here, on the meter that names the months. -->
    <div
      :id="idFor(['addresses'])"
      tabindex="-1"
      class="space-y-1 rounded-surface bg-surface p-4 ring-1 ring-inset ring-edge"
      aria-live="polite"
    >
      <h3 class="text-sm font-semibold text-ink">{{ copy.coverageHeading }}</h3>
      <p v-if="coverage.covered" class="text-sm text-ink-secondary">{{ copy.coverageComplete }}</p>
      <p v-for="gap in coverage.gaps" v-else :key="gap.from" class="text-sm text-ink-secondary">
        {{ copy.gap(formatDisplayMonth(gap.from), formatDisplayMonth(gap.to)) }}
      </p>
    </div>
  </section>
</template>
