import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  alertRoutingViewSchema,
  homeTimeSettingsSchema,
  myAlertsSchema,
  type AlertKey,
  type AlertRoute,
  type AlertRoutingView,
  type HomeTimeSettings,
  type MyAlerts,
} from "@silvicom/shared";
import { apiFetch, type ApiResult } from "@/lib/api";
import { HOME_TIME_KEY } from "@/components/homeTime/useHomeTime";

/**
 * Alert routing's data layer (HOME-TIME-PLAN HT5): Settings › Notifications' routing section
 * (`/api/alert-routing`), the home-time thresholds (`/api/roster/home-time/settings`) and the caller's
 * own "My alerts" (`/api/me/alerts`). ⚠ `apiFetch` serialises the body itself.
 */
export const ALERT_ROUTING_KEY = ["alert-routing"] as const;
const MY_ALERTS_KEY = ["my-alerts"] as const;
const THRESHOLDS_KEY = ["home-time-settings"] as const;

async function read<T>(call: Promise<ApiResult<T>>, fallback: string): Promise<T> {
  const res = await call;
  if (!res.ok || res.data === undefined) throw new Error(res.error?.message ?? fallback);
  return res.data;
}

export function useAlertRouting() {
  return useQuery({
    queryKey: ALERT_ROUTING_KEY,
    queryFn: async (): Promise<AlertRoutingView> => alertRoutingViewSchema.parse(await read(apiFetch<AlertRoutingView>("/api/alert-routing"), "Could not load who is told.")) as AlertRoutingView,
  });
}

/** Both writes change what "My alerts" says for the person saving, so that answer is asked again too. */
function useRoutingWrite<V>(call: (v: V) => Promise<ApiResult<unknown>>, fallback: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: V): Promise<void> => {
      await read(call(v), fallback);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ALERT_ROUTING_KEY });
      void qc.invalidateQueries({ queryKey: MY_ALERTS_KEY });
    },
  });
}

export const useSaveAlertRoutes = () =>
  useRoutingWrite<{ alert: AlertKey; routes: AlertRoute[] }>((v) => apiFetch(`/api/alert-routing/${v.alert}`, { method: "PUT", body: { routes: v.routes } }), "Could not save who is told.");

export const useResetAlertRoutes = () =>
  useRoutingWrite<{ alert: AlertKey }>((v) => apiFetch(`/api/alert-routing/${v.alert}`, { method: "DELETE" }), "Could not go back to the defaults.");

export function useHomeTimeThresholds() {
  return useQuery({
    queryKey: THRESHOLDS_KEY,
    queryFn: async (): Promise<HomeTimeSettings> =>
      homeTimeSettingsSchema.parse((await read(apiFetch<{ settings: HomeTimeSettings }>("/api/roster/home-time/settings"), "Could not load the alert times.")).settings),
  });
}

export function useSaveHomeTimeThresholds() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settings: HomeTimeSettings): Promise<void> => {
      await read(apiFetch("/api/roster/home-time/settings", { method: "PUT", body: settings }), "Could not save the alert times.");
    },
    // The board's chips are judged on the same numbers, and its list carries them.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: THRESHOLDS_KEY });
      void qc.invalidateQueries({ queryKey: HOME_TIME_KEY });
    },
  });
}

/** What the signed-in person receives; asked only while the panel is open. */
export function useMyAlerts(enabled: Ref<boolean>) {
  return useQuery({
    queryKey: MY_ALERTS_KEY,
    enabled: computed(() => enabled.value),
    queryFn: async (): Promise<MyAlerts> => myAlertsSchema.parse(await read(apiFetch<MyAlerts>("/api/me/alerts"), "Could not load your alerts.")) as MyAlerts,
  });
}
