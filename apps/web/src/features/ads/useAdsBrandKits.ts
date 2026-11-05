import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { AdAssetRef, AdBrandKitSave, AdBrandKitView } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * Brand kits (E2 over C1's doors, `routes/brandKits.ts`). Anyone who can view recruiting reads them; a save or an
 * upload is `ads.brand-kit`, an admin's, with no fresh sign-in, so no step-up is asked for here.
 */
export const ADS_BRAND_KITS_KEY = ["ads", "brand-kits"] as const;

export function useAdsBrandKits() {
  return useQuery({
    queryKey: ADS_BRAND_KITS_KEY,
    queryFn: async (): Promise<AdBrandKitView[]> => {
      const res = await apiFetch<{ brand_kits: AdBrandKitView[] }>("/api/ads/brand-kits");
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the brand kits");
      return res.data.brand_kits;
    },
  });
}

export function useSaveBrandKit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (save: AdBrandKitSave): Promise<void> => {
      const res = await apiFetch("/api/ads/brand-kits", { method: "POST", body: save });
      if (!res.ok) throw new Error(res.error?.message ?? "Could not save the brand kit");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ADS_BRAND_KITS_KEY }),
  });
}

export type PutFile = (url: string, file: File) => Promise<void>;

const putFile: PutFile = async (url, file) => {
  const res = await fetch(url, { method: "PUT", headers: { "content-type": file.type }, body: file });
  if (!res.ok) throw new Error("The file did not finish uploading.");
};

/**
 * One image into the kit: an upload URL, the bytes, then "accept", where the API reads them back and decides what
 * they are. A refusal there (a `.png` that is a PDF) is the API's sentence, shown as it is.
 */
export async function uploadKitAsset(file: File, put: PutFile = putFile): Promise<AdAssetRef> {
  const url = await apiFetch<{ upload_id: string; signed_url: string }>("/api/ads/brand-kits/assets/upload-url", { method: "POST", body: {} });
  if (!url.ok || !url.data) throw new Error(url.error?.message ?? "Could not start the upload");
  await put(url.data.signed_url, file);
  const accepted = await apiFetch<{ asset: AdAssetRef }>("/api/ads/brand-kits/assets", { method: "POST", body: { upload_id: url.data.upload_id } });
  if (!accepted.ok || !accepted.data) throw new Error(accepted.error?.message ?? "The file was not accepted");
  return accepted.data.asset;
}
