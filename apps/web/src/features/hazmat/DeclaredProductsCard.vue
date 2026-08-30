<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { canEditLoad, type HazmatLoadRow, type HazmatLoadStatus, type HazmatProduct } from "@silvicom/shared";
import { AppCard as BaseCard, AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import { PlusIcon } from "@silvicom/ui/icons";
import { useToastStore } from "@/stores/toast";
import HazmatProductLines from "@/features/hazmat/HazmatProductLines.vue";
import { buildEngineLines, emptyLine, equipmentFromTrailerType, equipmentSpec } from "@/features/hazmat/calcModel";
import { formLinesFromDeclared } from "@/features/hazmat/declaredLines";
import { useUpdateLoad } from "@/features/hazmat/useHazmatLoads";
import { useHazmatTrailersQuery } from "@/features/hazmat/useHazmatEquipment";

/**
 * The load's declared products — read-only on every status, editable on a `draft` (D-H23).
 *
 * This closes the dead end the H-C1 flow shipped with. "Start hazmat record" on a dispatch load
 * creates the record with `declaredLines: []` and toasts "declare the products in the workspace" —
 * and the workspace had no editor, so the only path that could declare products was the standalone
 * `/hazmat/loads/new` form, which never linked its record to a dispatch load (the orphan defect).
 * With D-H17 deleting that form, this IS the declaration surface.
 *
 * `PATCH /api/hazmat/loads/:id` has existed, validated and audited, since H5 and had no caller in
 * this app. Editing is gated on `canEditLoad` — the SAME predicate the API enforces — so a hidden
 * editor states the reason instead of a save being rejected after the work.
 *
 * The line editor is `HazmatProductLines`, the calculator's, unchanged: the questions a BOL answers
 * do not change because the answer is being stored rather than calculated, and a third product form
 * is exactly how the packaging vocabulary (D-H12) drifted apart the first time.
 */
const props = defineProps<{ load: HazmatLoadRow; canManage: boolean }>();

const toast = useToastStore();
const update = useUpdateLoad();
const { data: trailers } = useHazmatTrailersQuery();

/**
 * The equipment the lines are shaped by. Read from the load's TRAILER, the same source
 * `resolveVehicleKind` uses server-side (D-H4), so the editor's §171.8 defaults and the analysis
 * that follows cannot disagree about what the freight is riding on.
 */
const equipmentType = computed(() =>
  equipmentFromTrailerType((trailers.value ?? []).find((t) => t.id === props.load.trailer_id)?.trailer_type),
);

/** Mirrors the calculator: the tank-only fields ride on the engine KIND, not on the label "tanker". */
const isTank = computed(() => equipmentSpec(equipmentType.value)?.vehicleKind === "cargo_tank");

const editable = computed(() => props.canManage && canEditLoad(props.load.status as HazmatLoadStatus));
const editing = ref(false);
const draft = ref<ReturnType<typeof formLinesFromDeclared>>({ lines: [], unrecoverable: 0 });

const stored = computed(() => formLinesFromDeclared(props.load.declared_lines, equipmentType.value));
const declaredCount = computed(() => (Array.isArray(props.load.declared_lines) ? props.load.declared_lines.length : 0));

function startEditing() {
  const recovered = formLinesFromDeclared(props.load.declared_lines, equipmentType.value);
  // An empty declaration opens on one blank line rather than an empty list — the first thing the
  // user has to do is add a product either way, and a bare "Add product" button reads as a dead card.
  draft.value = { ...recovered, lines: recovered.lines.length ? recovered.lines : [emptyLine(equipmentType.value)] };
  editing.value = true;
}
function cancelEditing() {
  editing.value = false;
}

// Leaving `draft` open across a status change would let a save race the lifecycle; the API would
// refuse it, but the honest thing is to close the editor the moment editing stops being legal.
watch(editable, (canEdit) => {
  if (!canEdit) editing.value = false;
});

const resolvedCount = computed(() => draft.value.lines.filter((l) => l.product != null).length);

async function save() {
  const lines = buildEngineLines(draft.value.lines, equipmentType.value);
  try {
    await update.mutateAsync({ id: props.load.id, patch: { declaredLines: lines } });
    editing.value = false;
    toast.success(
      "Products saved",
      lines.length === 0 ? "The declaration is empty — analysis cannot clear it." : "Analyze the load to get its verdict.",
    );
  } catch (e) {
    toast.error("Could not save the products", e instanceof Error ? e.message : undefined);
  }
}

const productLabel = (line: unknown): string => {
  const row = (line ?? {}) as { declaredProduct?: HazmatProduct; hmtRef?: string };
  return row.declaredProduct?.label ?? row.hmtRef ?? "—";
};
const quantityLabel = (line: unknown): string => {
  const row = (line ?? {}) as { quantity?: { value?: number | null; unit?: string }; packageCount?: number | null };
  const qty = row.quantity?.value != null ? `${row.quantity.value} ${row.quantity.unit ?? ""}`.trim() : null;
  const packages = row.packageCount != null ? `${row.packageCount} package${row.packageCount === 1 ? "" : "s"}` : null;
  return [packages, qty].filter(Boolean).join(" · ") || "—";
};
</script>

<template>
  <BaseCard>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-sm font-semibold text-ink">Declared products</h2>
        <p class="mt-0.5 text-xs text-ink-muted">
          Every hazardous material on the shipping paper. The placard verdict is calculated from this
          declaration, so it is what a roadside inspection is defended with.
        </p>
      </div>
      <BaseButton v-if="editable && !editing" variant="secondary" size="sm" @click="startEditing">
        <AppIcon v-if="declaredCount === 0" :icon="PlusIcon" class="size-4" aria-hidden="true" />
        {{ declaredCount === 0 ? "Declare products" : "Edit products" }}
      </BaseButton>
    </div>

    <!-- ── read-only ─────────────────────────────────────────────────────────────────────────── -->
    <template v-if="!editing">
      <ul v-if="declaredCount" class="mt-4 divide-y divide-edge text-sm">
        <li v-for="(line, i) in load.declared_lines" :key="i" class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5">
          <span class="min-w-0 flex-1 text-ink">{{ productLabel(line) }}</span>
          <span class="shrink-0 text-ink-secondary">{{ quantityLabel(line) }}</span>
        </li>
      </ul>
      <p v-else class="mt-4 text-sm text-ink-muted">
        No products declared yet.
        <template v-if="editable">Declare them to analyze this load.</template>
        <template v-else-if="canManage">This record can no longer be edited, so it cannot be analyzed — cancel it and start a new one.</template>
      </p>

      <p v-if="stored.unrecoverable && editable" class="mt-3 text-xs text-ink-muted">
        {{ stored.unrecoverable }} of these {{ stored.unrecoverable === 1 ? "lines was" : "lines were" }} recorded
        before the declaration snapshot existed, or read from a scanned paper. They analyze normally, but
        editing here would rewrite them from less than they hold — cancel the record and declare it again
        if it needs changing.
      </p>
    </template>

    <!-- ── editing (draft only) ──────────────────────────────────────────────────────────────── -->
    <template v-else>
      <div class="mt-4">
        <HazmatProductLines
          :lines="draft.lines"
          :equipment-type="equipmentType"
          :is-tank="isTank"
          base-path="/api/hazmat"
          @add-line="draft.lines.push(emptyLine(equipmentType))"
          @remove-line="draft.lines.splice($event, 1)"
          @select-product="(index, product) => (draft.lines[index]!.product = product)"
          @clear-product="(index) => (draft.lines[index]!.product = null)"
        />
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-3">
        <BaseButton variant="primary" size="sm" :disabled="update.isPending.value" @click="save">
          {{ update.isPending.value ? "Saving…" : "Save products" }}
        </BaseButton>
        <BaseButton variant="secondary" size="sm" :disabled="update.isPending.value" @click="cancelEditing">Cancel</BaseButton>
        <span class="text-xs text-ink-muted">
          {{ resolvedCount }} product{{ resolvedCount === 1 ? "" : "s" }} will be saved.
          <template v-if="resolvedCount < draft.lines.length">
            Lines without a resolved product are dropped — an unknown material can never enter a load.
          </template>
        </span>
      </div>
    </template>
  </BaseCard>
</template>
