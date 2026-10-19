<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import { AppButton as BaseButton, AppFormField as FormField, AppTextarea as BaseTextarea } from "@silvicom/ui";
import { REPAIR_OUTCOME_TEXT, repairClock, repairUnitName, type CalendarDay, type RepairCandidate, type RoadsideRepairDto } from "@silvicom/shared";
import { useSessionStore } from "@/stores/session";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDate, formatDateTime } from "@/lib/format";
import { RepairDecisionError, useDecideRepair } from "./useRoadsideInspections";

/**
 * One violated unit's repair and maintenance's decision over it (IC11, Q-IC13) — the ONE way a repair is
 * named, used by the inspection page's Repair card and by the Shop's "Roadside repairs due" page alike
 * (Q-IC16 (a)): a technician, who cannot open the inspection page, decides on the same component a safety
 * manager watches there, so the two cannot drift.
 *
 * Nothing is pre-chosen (Q-IC14, measured: one work order in the window is the repair only some of the
 * time): a person accepts the work order whose jobs answer the violations, or says where the repair was
 * done instead. Deciding needs maintenance's manage level, which the API checks; the buttons only follow it.
 * Each unit holds its own mutation, so a refusal is said under the unit it is about.
 */

const props = defineProps<{ inspectionId: string; repair: RoadsideRepairDto; today: CalendarDay }>();
const r = toRef(props, "repair");

const session = useSessionStore();
const decide = useDecideRepair(toRef(props, "inspectionId"));

/** The badge: closed when decided or repaired at the scene; otherwise the clock, red once overdue. */
const badge = computed((): { text: string; tone: string } => {
  const d = r.value.decision;
  if (d) return { text: d.outcome === "accepted" ? "Repair recorded" : "Repaired outside FleetPal", tone: "success" };
  if (r.value.proposal.outcome === "repaired_at_scene") return { text: "Repaired at the scene", tone: "success" };
  const c = repairClock(r.value.dueOn, props.today);
  if (c.overdue) return { text: `Overdue ${c.days} ${c.days === 1 ? "day" : "days"}`, tone: "danger" };
  return { text: c.days === 0 ? "Due today" : `${c.days} ${c.days === 1 ? "day" : "days"} left`, tone: c.days <= 3 ? "warning" : "neutral" };
});

/** What may be decided on a unit: anything the engine could not close by itself. */
const decidable = computed(() => session.can("maintenance") && r.value.proposal.outcome !== "repaired_at_scene");

const writing = ref(false);
const note = ref("");
const failure = computed(() => {
  const e = decide.error.value;
  if (!e) return null;
  return e instanceof RepairDecisionError && e.code === "changed"
    ? "This repair changed while the page was open — a work order opened, or someone else decided. It is shown again above; look before deciding."
    : e.message;
});

function accept(c: RepairCandidate) {
  decide.mutate({ action: "accept", unitId: r.value.unitId, basedOn: r.value.basedOn, workOrderId: c.workOrderId });
}
function startOutside() {
  decide.reset();
  note.value = "";
  writing.value = true;
}
function saveOutside() {
  decide.mutate({ action: "outside", unitId: r.value.unitId, basedOn: r.value.basedOn, note: note.value.trim() }, { onSuccess: () => (writing.value = false) });
}
</script>

<template>
  <section class="text-sm" data-test="repair-unit">
    <div class="flex flex-wrap items-center gap-2">
      <h3 class="text-sm font-semibold text-ink">{{ repairUnitName(repair) }}</h3>
      <span :class="[BADGE_BASE, toneClass(badge.tone)]" data-test="repair-badge">{{ badge.text }}</span>
      <span class="text-xs text-ink-tertiary">Due {{ formatDate(repair.dueOn) }}</span>
    </div>
    <slot name="context" />
    <ul v-if="repair.violations.length" class="mt-1 text-ink-muted" data-test="repair-violations">
      <li v-for="(v, i) in repair.violations" :key="i">{{ v.code }}<template v-if="v.description"> — {{ v.description }}</template></li>
    </ul>

    <div v-if="repair.decision" class="mt-3 text-ink" data-test="repair-decision">
      <p v-if="repair.decision.workOrder">
        Repaired under FleetPal work order <span class="font-medium">{{ repair.decision.workOrder.reference ?? repair.decision.workOrder.workOrderId }}</span>
        (opened {{ formatDate(repair.decision.workOrder.openedOn) }}).
      </p>
      <p v-else>Repaired outside FleetPal: “{{ repair.decision.note }}”</p>
      <p class="text-ink-muted">Recorded by {{ repair.decision.decidedBy ?? "a former user" }} on {{ formatDateTime(repair.decision.decidedAt) }}.</p>
    </div>

    <p class="mt-3 text-ink-muted" data-test="repair-proposal">{{ REPAIR_OUTCOME_TEXT[repair.proposal.outcome] }}</p>
    <ul v-if="repair.proposal.candidates.length" class="mt-2 space-y-2" data-test="repair-candidates">
      <li v-for="c in repair.proposal.candidates" :key="c.workOrderId" class="flex flex-wrap items-start justify-between gap-2 rounded-detail border border-edge p-3" data-test="repair-candidate">
        <div>
          <p class="font-medium text-ink">
            {{ c.reference ?? c.workOrderId }}
            <span class="font-normal text-ink-muted"> · opened {{ formatDate(c.openedOn) }} · {{ c.status?.toLowerCase() ?? "status unknown" }}</span>
          </p>
          <p v-if="c.jobs.length" class="text-ink-muted">{{ c.jobs.join(", ") }}</p>
          <p v-else-if="c.description" class="text-ink-muted">{{ c.description }}</p>
        </div>
        <BaseButton
          v-if="decidable && repair.decision?.workOrder?.workOrderId !== c.workOrderId"
          :disabled="decide.isPending.value"
          data-test="repair-accept"
          @click="accept(c)"
        >
          This is the repair
        </BaseButton>
      </li>
    </ul>

    <div v-if="decidable && !writing" class="mt-3">
      <BaseButton variant="link" data-test="repair-outside" @click="startOutside">Repaired outside FleetPal…</BaseButton>
    </div>
    <form v-if="writing" class="mt-3 space-y-3" data-test="repair-outside-form" @submit.prevent="saveOutside">
      <FormField v-slot="{ id: fieldId }" label="Where was it repaired?" required>
        <BaseTextarea :id="fieldId" v-model="note" maxlength="1000" placeholder="For example: TA Joliet, road-service invoice 8812." />
      </FormField>
      <div class="flex gap-2">
        <BaseButton variant="primary" type="submit" :disabled="!note.trim() || decide.isPending.value" data-test="repair-outside-save">Save</BaseButton>
        <BaseButton @click="writing = false">Cancel</BaseButton>
      </div>
    </form>

    <p v-if="failure" class="mt-3 text-sm text-danger-700" role="alert" data-test="repair-error">{{ failure }}</p>
  </section>
</template>
