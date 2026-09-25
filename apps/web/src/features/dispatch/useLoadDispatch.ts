import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { LoadDispatch, LoadDispatchPreview, LoadDispatchSummary } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { loadKeyPrefix, loadsKey } from "./useDispatchLoads";

/**
 * Dispatch — the office sends a McLeod load to a driver (LOADS-MIRROR-PLAN.md LR-D3; D-LMR5..7).
 *
 * The text the driver would read is NEVER composed here. The API composes it (`composeLoadDispatchSms`,
 * on the carrier's clock) for both the preview and the send, so what the dispatcher reads before Send
 * is byte for byte what `load_dispatches.body` stores. A browser composing it would read appointments
 * on the dispatcher's own clock and could disagree with the record.
 */

/** The preview for one load and one chosen driver; re-fetched whenever the choice changes. */
export function useDispatchPreview(loadId: Ref<string | null>, driverId: Ref<string>) {
  return useQuery({
    queryKey: computed(() => ["dispatch", "dispatch-preview", loadId.value, driverId.value] as const),
    enabled: computed(() => Boolean(loadId.value && driverId.value)),
    queryFn: async (): Promise<LoadDispatchPreview> => {
      const res = await apiFetch<{ preview: LoadDispatchPreview }>(
        `/api/dispatch/loads/${loadId.value}/dispatch-preview?driverId=${encodeURIComponent(driverId.value)}`,
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not prepare the message.");
      return res.data.preview;
    },
  });
}

export function useDispatchLoad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { loadId: string; driverId: string }): Promise<LoadDispatch> => {
      const res = await apiFetch<{ dispatch: LoadDispatch }>(`/api/dispatch/loads/${payload.loadId}/dispatch`, {
        method: "POST",
        body: { driverId: payload.driverId },
      });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not dispatch the load.");
      return res.data.dispatch;
    },
    onSuccess: async () => {
      // The board's "Dispatched to …" and the open load page both read the dispatch record.
      await Promise.all([
        qc.invalidateQueries({ queryKey: loadsKey }),
        qc.invalidateQueries({ queryKey: loadKeyPrefix }),
      ]);
    },
  });
}

/**
 * Why a text did not go out, in the office's words. Keyed by the API's stable codes
 * (`LOAD_DISPATCH_SMS_REASONS`); an unknown code is shown as it is rather than guessed at.
 */
const SMS_REASON_TEXT: Record<string, string> = {
  sms_not_configured: "Text messages aren't set up yet, so no text was sent.",
  no_dispatch_consent: "No text was sent: drivers haven't agreed to receive dispatch texts yet.",
};
export const smsReasonText = (code: string | null): string | null =>
  code === null ? null : (SMS_REASON_TEXT[code] ?? `No text was sent (${code}).`);

/**
 * "Dispatched to …", never "Sent to …" while no text has gone out. The dispatch is real — the office
 * decided who takes the load, and the record says so — but the driver has not been told by text, and
 * the page must not let anybody believe they were (D-LMR6: the outcome is recorded, never assumed).
 */
export function dispatchHeadline(d: LoadDispatchSummary | null | undefined): string {
  if (!d) return "Not dispatched";
  const who = d.driverName ?? "a driver no longer on the roster";
  return `Dispatched to ${who} · ${formatDateTime(d.sentAt, d.sentAt)}`;
}
