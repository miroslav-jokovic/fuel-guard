import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type {
  HazmatCargoTankProfileCreateRequest,
  HazmatCargoTankProfileRow,
  HazmatCargoTankProfilesResponse,
  HazmatCargoTankProfileUpdateRequest,
} from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { MaybeRefOrGetter } from "vue";

/**
 * Cargo-tank profile data layer (plan H5). CRUD goes through the API (`/api/hazmat/profiles`) so writes
 * are role-gated + audited; the trailer picker reads the `trailers` table directly (a minimal query kept
 * inside this feature to avoid importing another feature's internals — the boundary rule).
 */
const profilesKey = ["hazmat", "profiles"] as const;

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await apiFetch<T>(path, { method, ...(body === undefined ? {} : { body }) });
  if (!res.ok) throw new Error(res.error?.message ?? "That did not work");
  return res.data as T;
}

export function useHazmatProfilesQuery(options: { enabled?: MaybeRefOrGetter<boolean> } = {}) {
  return useQuery({
    queryKey: profilesKey,
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
    queryFn: async (): Promise<HazmatCargoTankProfileRow[]> => {
      const res = await call<HazmatCargoTankProfilesResponse>("/api/hazmat/profiles");
      return res.profiles;
    },
  });
}

/** Minimal trailer list for the equipment picker (id + unit only). */
export interface TrailerOption {
  id: string;
  unit_number: string;
  /** Equipment type (D-H4) — what `resolveVehicleKind` reads to decide bulk vs non-bulk. */
  trailer_type: string | null;
}
export function useHazmatTrailersQuery(options: { enabled?: MaybeRefOrGetter<boolean> } = {}) {
  return useQuery({
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
    queryKey: ["hazmat", "trailer-options"] as const,
    queryFn: async (): Promise<TrailerOption[]> => {
      const { data, error } = await supabase.from("trailers").select("id, unit_number, trailer_type").order("unit_number", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as TrailerOption[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

function useProfilesMutation<TVars, TData>(fn: (vars: TVars) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: profilesKey });
    },
  });
}

export function useCreateProfile() {
  return useProfilesMutation((req: HazmatCargoTankProfileCreateRequest) => call<{ id: string }>("/api/hazmat/profiles", "POST", req));
}
export function useUpdateProfile() {
  return useProfilesMutation((vars: { id: string; req: HazmatCargoTankProfileUpdateRequest }) =>
    call<{ ok: true }>(`/api/hazmat/profiles/${vars.id}`, "PUT", vars.req),
  );
}
export function useDeleteProfile() {
  return useProfilesMutation((id: string) => call<{ ok: true }>(`/api/hazmat/profiles/${id}`, "DELETE"));
}
