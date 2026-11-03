import { computed, type ComputedRef, type Ref } from "vue";
import {
  dqCapturableSpecs,
  EQUIPMENT_ITEMS,
  moduleEnabled,
  unitFileSpecs,
  type FileItemState,
  type OwnershipType,
  type UnitSubjectType,
} from "@silvicom/shared";
import { useSessionStore } from "@/stores/session";
import { useModulesQuery } from "@/composables/useModules";
import { useDriverQuery } from "@/composables/useDrivers";
import { useDispatchHoldQuery, useUnitFilesQuery } from "@/composables/useCompliance";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useTrailersQuery } from "@/composables/useTrailers";

/**
 * What a dropped scan can prove, for one subject — the options `DocumentDropCard` asks "What does it
 * prove?" with (D-DQ10).
 *
 * Lifted out of `QualificationSection` and `UnitFileSection` when the lists gained an upload dialog
 * (DQ-FILE-COLUMN): a list cell has the same subject and must offer the same options as the file
 * page, and a third copy of either derivation is exactly the drift D-DQ6 forbids. Both sections read
 * from here now, as does `FileUploadDialog`'s host page.
 */
export interface DropItem {
  key: string;
  label: string;
  evidenceKind: string;
}

/** An item the file still needs, as the upload dialog lists it beside the drop zone. */
export interface OutstandingItem {
  key: string;
  label: string;
  state: FileItemState;
}

/**
 * A driver's §391.51 items. From `dqCapturableSpecs`, not the file's items: an advisory item (ELDT) is
 * absent from the checklist until evidence exists, and this list is where that first evidence comes
 * from (D8). Restricted requirements (Phase G, D-DQ15) stay absent for roles that cannot record them —
 * the API would refuse the record anyway; the option must not offer a dead end.
 */
export function useDriverDropItems(driverId: Ref<string | null>): ComputedRef<DropItem[]> {
  const session = useSessionStore();
  const modules = useModulesQuery();
  const driverQ = useDriverQuery(computed(() => driverId.value ?? ""));
  const holdQ = useDispatchHoldQuery(driverId);
  return computed(() =>
    dqCapturableSpecs({
      includeHazmat: moduleEnabled(modules.data.value ?? null, "hazmatguard"),
      hasCdl: Boolean(driverQ.data.value?.cdl_number),
      returnToDutyRequired: driverQ.data.value?.return_to_duty_required === true,
      returnToDutyViolationOn: holdQ.data.value?.violationOn ?? null,
    })
      .filter((spec) => spec.evidenceKinds.every((k) => session.canReadKind(k)))
      // Every catalogue item names at least one evidence kind; the fallback only satisfies the index check.
      .map((spec) => ({ key: spec.key, label: spec.label, evidenceKind: spec.evidenceKinds[0] ?? "other" })),
  );
}

/**
 * A truck's or trailer's items, by its type and ownership (D-UF11): title and lease apply only once
 * ownership is known. The unit row is the list's own (vue-query shares the read), and the rollup's
 * ownership stands in where the roster has none.
 */
export function useUnitDropItems(type: UnitSubjectType, unitId: Ref<string | null>) {
  const filesQ = useUnitFilesQuery(type);
  const units = type === "tractor" ? useVehiclesQuery() : useTrailersQuery();
  const row = computed(() => (filesQ.data.value?.units ?? []).find((u) => u.subject_id === unitId.value) ?? null);
  const ownership = computed<OwnershipType | null>(() => {
    const unit = (units.data.value ?? []).find((u) => u.id === unitId.value);
    return unit?.ownership_type ?? row.value?.ownership ?? null;
  });
  const items = computed<DropItem[]>(() =>
    unitFileSpecs(type, ownership.value).specs.map((s) => ({ key: s.key, label: s.label, evidenceKind: s.evidenceKinds[0] ?? "other" })),
  );
  const labelOf = new Map(EQUIPMENT_ITEMS.map((s) => [s.key, s.label]));
  const outstanding = computed<OutstandingItem[]>(() =>
    (row.value?.items ?? [])
      .filter((c) => c.state !== "current")
      .map((c) => ({ key: c.key, label: labelOf.get(c.key) ?? c.key, state: c.state })),
  );
  return { items, ownership, outstanding };
}
