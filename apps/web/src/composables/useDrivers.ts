import { computed, type Ref } from "vue";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import { EMPLOYED_DRIVER_STATUSES } from "@fuelguard/shared";
import type { Driver, DriverDetail, DriverInput, DriverUpdateRequest } from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";

const DRIVER_COLS =
  "id, org_id, user_id, full_name, employee_id, phone, status, samsara_driver_id, samsara_username, current_hos_status, current_hos_vehicle, current_hos_at, current_location, app_username, app_access_enabled, created_at, updated_at, archived_at";

const driversKey = ["drivers"] as const;

// Samsara driver sync now runs as a background job (kind `sync_drivers`) — the Drivers page drives it via
// useBackgroundSync + the jobs ledger, so there's no inline-mutation hook here anymore (plan WQ1c).

/** One driver's full profile — DQ1's `GET /api/roster/drivers/:id`. */
export function useDriverQuery(id: Ref<string>) {
  return useQuery({
    queryKey: ["roster", "driver", id] as const,
    enabled: computed(() => Boolean(id.value)),
    queryFn: async (): Promise<DriverDetail | null> => {
      const res = await apiFetch<{ driver: DriverDetail }>(`/api/roster/drivers/${id.value}`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the driver.");
      return res.data.driver;
    },
  });
}

/**
 * Edit one driver's master data through the ROSTER API, not through PostgREST.
 *
 * Deliberately not `useUpdateDriver` above. That one writes `drivers` straight from the browser on
 * the old five-field `driverInputSchema`; this one goes through `PATCH /api/roster/drivers/:id`,
 * which validates against `driverUpdateSchema`, runs `resolveDriverUpdate` (so an edit can claim a
 * telematics-owned row and stamp a termination date) and writes an audit row. Personal data —
 * date of birth is the first of it — takes the audited path.
 *
 * Invalidates BOTH caches: the roster detail this page reads, and the `drivers` list the roster
 * table reads, because a status or name edit shows up there.
 */
export function useUpdateDriverProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string; input: DriverUpdateRequest }): Promise<DriverDetail> => {
      const res = await apiFetch<{ driver: DriverDetail }>(`/api/roster/drivers/${payload.id}`, {
        method: "PATCH",
        body: payload.input,
      });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not save the driver.");
      return res.data.driver;
    },
    onSuccess: (_driver, payload) => {
      void qc.invalidateQueries({ queryKey: ["roster", "driver", payload.id] });
      void qc.invalidateQueries({ queryKey: driversKey });
    },
  });
}

export function useDriversQuery() {
  return useQuery({
    queryKey: driversKey,
    queryFn: async (): Promise<Driver[]> => {
      // Applicants are excluded by the SHARED list rather than by name: Fleet > Drivers is the
      // employed roster, and somebody who has only applied belongs in Recruitment until they are
      // hired (HIRING-PLAN.md D-HIRE5).
      //
      // ⚠ ARCHIVED drivers are NOT excluded here, and that is the decision rather than an oversight.
      // Five surfaces use this query as a NAME LOOKUP — `useAnomalyDetail`, `AssignmentHistory`,
      // `HazmatLoadDetailPage`, `FleetReadiness`, `DriverAppSettingsPage`. Filtering here would make
      // an archived driver's name stop resolving, turning a historical anomaly or a past assignment
      // into one attributed to nobody. Archiving hides a row from a LIST somebody scans; it does not
      // erase the person from records they appear in. `DriversPage` filters on `archived_at` itself.
      const { data, error } = await supabase
        .from("drivers")
        .select(DRIVER_COLS)
        .in("status", [...EMPLOYED_DRIVER_STATUSES])
        .order("full_name", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Driver[];
    },
    // Reflect background identity-sync updates without a manual reload.
    refetchInterval: 60_000,
  });
}

export function useCreateDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: DriverInput): Promise<Driver> => {
      const { data, error } = await supabase
        .from("drivers")
        .insert(input)
        .select(DRIVER_COLS)
        .single();
      if (error) throw new Error(error.message);
      return data as Driver;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: driversKey }),
  });
}

export function useUpdateDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string; input: DriverInput }): Promise<Driver> => {
      const { data, error } = await supabase
        .from("drivers")
        .update(payload.input)
        .eq("id", payload.id)
        .select(DRIVER_COLS)
        .single();
      if (error) throw new Error(error.message);
      return data as Driver;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: driversKey }),
  });
}

/** Assign (or clear) a driver on a vehicle, then refresh both lists. */
export function useAssignDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { vehicleId: string; driverId: string | null }): Promise<void> => {
      const { error } = await supabase
        .from("vehicles")
        .update({ assigned_driver_id: payload.driverId })
        .eq("id", payload.vehicleId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      qc.invalidateQueries({ queryKey: driversKey });
    },
  });
}

/**
 * Archive or un-archive a roster row (migration 0235).
 *
 * ── WHY THIS GOES THROUGH THE API AND NOT POSTGREST, UNLIKE ITS NEIGHBOURS ────────────────────
 * `useUpdateDriver` above writes `drivers` straight from the browser. This one cannot: 0235's
 * `guard_driver_archive_writer` refuses `archived_at` to every JWT-bearing writer (DR011), so the
 * PostgREST path is closed by the database, on purpose. Hiding a person from the roster is an act
 * somebody should be able to ask "who did that, and when" about, and only the API writes the
 * `driver.archived` audit row.
 *
 * Invalidates BOTH the `drivers` list and the applicant pipeline: an applicant is a `drivers` row
 * (D-HIRE5), so archiving one changes a board this key does not name.
 */
export function useArchiveDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string; archived: boolean }): Promise<void> => {
      const res = await apiFetch(
        `/api/roster/drivers/${payload.id}/${payload.archived ? "archive" : "unarchive"}`,
        { method: "POST" },
      );
      if (!res.ok) {
        throw new Error(
          res.error?.message ?? (payload.archived ? "Could not archive." : "Could not restore."),
        );
      }
    },
    onSuccess: (_v, payload) => {
      void qc.invalidateQueries({ queryKey: driversKey });
      void qc.invalidateQueries({ queryKey: ["roster", "driver", payload.id] });
      void qc.invalidateQueries({ queryKey: ["recruitment", "pipeline"] });
    },
  });
}
