import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { AdsSwipeEntryView, AdsSwipePageSave } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { putFile, type PutFile } from "./useAdsBrandKits";

/**
 * The swipe file (ADS-PLATFORM-V2-PLAN V2r, D-AD36) over `routes/swipe.ts`. Anyone who can VIEW recruiting reads
 * it; saving, reading again and archiving are a MANAGE grant (`ADS_AUTHORITY.save_to_swipe_file: person`), which
 * the card asks `session.can("recruitment")` for. Every refusal is the API's own sentence, shown as it is.
 *
 * A saved entry is read by the queue (`ads_swipe_read`), so the list is read again while any entry is waiting and
 * stops once none is: the reading appears without anyone reloading, and an idle page makes no calls.
 */
export const ADS_SWIPE_KEY = ["ads", "swipe"] as const;
export const SWIPE_WAITING_POLL_MS = 5_000;

export const anyWaiting = (entries: readonly AdsSwipeEntryView[] | undefined): boolean =>
  (entries ?? []).some((e) => e.state === "waiting");

export function useAdsSwipe() {
  return useQuery({
    queryKey: ADS_SWIPE_KEY,
    queryFn: async (): Promise<AdsSwipeEntryView[]> => {
      const res = await apiFetch<{ entries: AdsSwipeEntryView[] }>("/api/ads/swipe");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the swipe file");
      return res.data.entries;
    },
    refetchInterval: (q) => (anyWaiting(q.state.data) ? SWIPE_WAITING_POLL_MS : false),
  });
}

/**
 * A picture into the swipe file: an upload URL, the bytes, then the save, where the API reads them back and decides
 * what they are (the brand kit's `acceptAsset`). A `.png` that is a PDF is refused there, in the API's words.
 */
export async function saveSwipePicture(file: File, note: string | null, put: PutFile = putFile): Promise<void> {
  const url = await apiFetch<{ upload_id: string; signed_url: string }>("/api/ads/swipe/pictures/upload-url", { method: "POST", body: {} });
  if (!url.ok || !url.data) throw new Error(url.error?.message ?? "Could not start the upload");
  await put(url.data.signed_url, file);
  const saved = await apiFetch("/api/ads/swipe/pictures", { method: "POST", body: { upload_id: url.data.upload_id, note } });
  if (!saved.ok) throw new Error(saved.error?.message ?? "The picture was not saved");
}

export type SwipeSave = { kind: "page"; save: AdsSwipePageSave } | { kind: "picture"; file: File; note: string | null };

export function useSaveSwipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ask: SwipeSave): Promise<void> => {
      if (ask.kind === "picture") return saveSwipePicture(ask.file, ask.note);
      const res = await apiFetch("/api/ads/swipe/pages", { method: "POST", body: ask.save });
      if (!res.ok) throw new Error(res.error?.message ?? "The page was not saved");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ADS_SWIPE_KEY }),
  });
}

/** "Read again" (a new attempt) or "Archive" (removal is an archive: `delete_anything` is "never"). */
export function useSwipeAct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, act }: { id: string; act: "read" | "archive" }): Promise<void> => {
      const res = await apiFetch(`/api/ads/swipe/${encodeURIComponent(id)}/${act}`, { method: "POST", body: {} });
      if (!res.ok) throw new Error(res.error?.message ?? (act === "read" ? "Could not read it again" : "Could not archive it"));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ADS_SWIPE_KEY }),
  });
}
