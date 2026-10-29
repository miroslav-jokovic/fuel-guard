import type { AssetDto } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * The maker and model of a tablet, read off the ones already on file (owner 2026-10-29: "Manufacturer,
 * if possible, should be scanned the same way we are doing for IMEI and serial number").
 *
 * ── WHY THE IMEI, AND NOT A MANUFACTURER BARCODE ──────────────────────────────────────────────
 * A tablet's sticker carries no barcode for the maker — "Samsung" is printed, never encoded. What it
 * does carry is the IMEI, whose first eight digits are the TAC, the Type Allocation Code: by 3GPP TS
 * 23.003 one TAC is allocated to one device model of one maker, so every SM-T575 in a box of ten
 * shares it. The public TAC database is GSMA's and licensed, so this does not look the TAC up in the
 * world — it looks it up in the shop's own tablets. The first of a model is entered by hand (or by
 * its `SM-`/`TB-` model barcode, `deviceSticker.ts`); every later one scanned fills in from it.
 *
 * ── IT NEVER GUESSES BETWEEN TWO ANSWERS ──────────────────────────────────────────────────────
 * If two tablets with the same TAC were entered with different makers or models, one of them is
 * wrong and this cannot know which, so it answers nothing and the person types it.
 */

export interface SameModel {
  manufacturer: string;
  model: string;
  /** The tablet it was copied from, so the form can say where the answer came from. */
  fromDisplayNo: string;
}

export const tacOf = (imei: string): string => imei.slice(0, 8);

export function sameModelFrom(
  assets: readonly Pick<AssetDto, "imei" | "manufacturer" | "model" | "displayNo">[],
  imei: string,
): SameModel | null {
  const tac = tacOf(imei);
  const matches = assets.filter(
    (a) => a.imei && a.imei !== imei && a.imei.startsWith(tac) && (a.manufacturer || a.model),
  );
  if (matches.length === 0) return null;
  const key = (a: (typeof matches)[number]) => `${a.manufacturer ?? ""}|${a.model ?? ""}`;
  if (new Set(matches.map(key)).size > 1) return null;
  const first = matches[0]!;
  return { manufacturer: first.manufacturer ?? "", model: first.model ?? "", fromDisplayNo: first.displayNo };
}

/**
 * Ask the API for tablets whose IMEI contains the TAC (its `search` reads the IMEI, M9b), then keep the
 * ones that START with it. A failed read is "no answer", never an error on the form: the person can
 * still type the maker, which is what they did before this existed.
 */
export async function findSameModel(imei: string): Promise<SameModel | null> {
  try {
    const params = new URLSearchParams({ search: tacOf(imei), limit: "50" });
    const r = await apiFetch<{ assets: AssetDto[] }>(`/api/maintenance/inventory/assets?${params}`);
    return r.ok && r.data ? sameModelFrom(r.data.assets, imei) : null;
  } catch {
    return null;
  }
}
