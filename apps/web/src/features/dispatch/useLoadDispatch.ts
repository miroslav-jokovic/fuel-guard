import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  phoneSilentSince,
  type DispatchReach,
  type DispatchSeatNote,
  type LoadDispatch,
  type LoadDispatchPreview,
  type LoadDispatchSummary,
} from "@silvicom/shared";
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
  // S1.1: an `app` / `sent` dispatch is in the driver's app — say so, the one case where "sent" is true.
  const where = d.channel === "app" && d.outcome === "sent" ? " · in their app" : "";
  const seen = dispatchSeenText(d);
  return `Dispatched to ${who}${where} · ${formatDateTime(d.sentAt, d.sentAt)}${seen ? ` · ${seen}` : ""}`;
}

/**
 * "Seen 11/27/2026 9:14 AM" — the driver's "Got it" on THIS dispatch (T1 N-9). For a team (two seats,
 * O-3) it names who has seen it and who has not, because "seen" with one of two seats is half a fact.
 * Null when nobody has: the reach line says why that may be.
 */
export function dispatchSeenText(d: Pick<LoadDispatchSummary, "acknowledgements" | "seats">): string | null {
  const acks = d.acknowledgements ?? [];
  const seats = d.seats ?? [];
  if (seats.length <= 1) return acks[0] ? `Seen ${formatDateTime(acks[0].at, acks[0].at)}` : null;
  if (acks.length === 0) return null;
  const name = (id: string, fallback: string | null) => fallback ?? seats.find((s) => s.driverId === id)?.driverName ?? "a driver";
  const seenBy = acks.map((a) => `${name(a.driverId, a.driverName)} ${formatDateTime(a.at, a.at)}`);
  const notYet = seats.filter((s) => !acks.some((a) => a.driverId === s.driverId)).map((s) => `${s.driverName ?? "a driver"} not yet`);
  return `Seen by ${[...seenBy, ...notYet].join("; ")}`;
}

/**
 * Why a sent load is in nobody's app, in the office's words (`DispatchReach`). Null when it reaches one.
 * `driverName` is the dispatched driver's; a team's second seat follows the first (0655).
 */
export function dispatchReachText(reach: DispatchReach | undefined, driverName: string | null): string | null {
  if (!reach || reach.ok) return null;
  switch (reach.reason) {
    case "no_app_login":
      return `Not in ${driverName ?? "the driver"}'s app — no app login`;
    case "uncovered_in_mcleod":
      return "Nobody sees this load in the app — McLeod has it uncovered";
    case "closed":
      return "McLeod has closed this load";
  }
}

/** The dispatch names a driver McLeod does not seat on the load. They still see it; the office should know. */
export function seatNoteText(note: DispatchSeatNote | undefined): string | null {
  return note === "mcleod_seats_someone_else" ? "McLeod has somebody else on this load. The driver it was sent to still sees it." : null;
}

/** D-MK22: "Driver's phone last reached us at …" on an open load whose phone has been quiet an hour. */
export function phoneSilentText(load: { status: string }, d: LoadDispatchSummary | null | undefined, now = Date.now()): string | null {
  const at = phoneSilentSince(load, d, now);
  return at ? `Driver's phone last reached us at ${formatDateTime(at, at)}` : null;
}
