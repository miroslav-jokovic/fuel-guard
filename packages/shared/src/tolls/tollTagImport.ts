import { z } from "zod";
import { normaliseTagNumber, tollTagKey, TOLL_PROVIDER_LABEL, type TollProvider } from "./tollTags.js";
import { tollProviderSchema, type TransponderDto } from "./tollContract.js";
import { formatDisplayDate } from "../displayDate.js";
import { wallClockInZone } from "../calendarDay.js";

/**
 * What a spreadsheet of toll tags does to the fleet (TOLLS-PER-TRUCK-PLAN.md TL2b). Pure, and run on
 * BOTH sides: the browser runs it to show the preview before anything is written, and the API runs
 * it again on what is on file at the moment of the import, because a preview is advice — another
 * person may have moved a tag in the minutes between.
 *
 * ── EACH LINE SAYS "THIS TAG IS ON THIS TRUCK FROM THIS DAY" ─────────────────────────────────
 * That one sentence becomes exactly one of 0622's acts, decided against the tag's history:
 *
 *   · `add`       — the tag is not on file: register it, on that truck, from that day.
 *   · `move`      — on file and on another truck (or none) since an earlier day: move it from that day.
 *   · `backdate`  — already on THIS truck, but from a later day than the sheet says. This is the case
 *                   the import exists for: tags first typed in "from now", then the six months behind
 *                   them loaded (Q-TL4). The entry with the wrong start is voided and the tag goes on
 *                   again from the sheet's day, so the months between reach this truck.
 *   · `unchanged` — already on this truck from that day or earlier: nothing to do. Importing the same
 *                   sheet twice is therefore harmless.
 *   · `refused`   — and why, in words: the truck is not in the fleet, the tag is retired, or the day
 *                   falls inside another truck's time with the tag. History is never slid underneath
 *                   another truck's entry (TL005); that needs a person to void the wrong entry.
 *
 * ── A TAG TWICE IN ONE SHEET IS REFUSED BOTH TIMES ───────────────────────────────────────────
 * Two lines for one tag are either a move written as two rows or a typing slip, and the sheet cannot
 * say which. Both lines are refused with each other's line number, rather than the second silently
 * winning. Matching uses `tollTagKey`, so `00812345678` and `812345678` (Excel's habit) are one tag.
 */

/** One usable line, its day already turned into the instant it starts on the company's clock. */
export interface TollTagImportItem {
  line: number;
  unitNumber: string;
  provider: TollProvider;
  tagNumber: string;
  /** Midnight of the start day, on the company's clock, as an ISO instant. */
  at: string;
  issuer: string | null;
}

export interface ImportVehicle {
  id: string;
  unitNumber: string;
  inService: boolean;
}

export type TollTagImportVerdict =
  | { kind: "add"; vehicleId: string }
  | { kind: "move"; vehicleId: string; transponderId: string; fromUnit: string | null }
  | { kind: "backdate"; vehicleId: string; transponderId: string; entryId: string; previousFrom: string }
  | { kind: "unchanged"; transponderId: string; since: string }
  | { kind: "refused"; reason: string };

export interface PlannedTollTagLine {
  item: TollTagImportItem;
  verdict: TollTagImportVerdict;
}

/** A unit number as people type it: `654`, `0654`, `Unit 654`, `#654`, ` 654 `. */
export function unitKey(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/^(UNIT|TRUCK|TRACTOR)\s*/, "")
    .replace(/^#\s*/, "")
    .replace(/\s+/g, "");
}

/** The truck a typed unit names, matching leading zeros only when that still names one truck. */
export function findVehicle(vehicles: readonly ImportVehicle[], typed: string): ImportVehicle[] {
  const key = unitKey(typed);
  const exact = vehicles.filter((v) => unitKey(v.unitNumber) === key);
  if (exact.length) return exact;
  const loose = key.replace(/^0+/, "");
  return vehicles.filter((v) => unitKey(v.unitNumber).replace(/^0+/, "") === loose);
}

/** An instant as the day it falls on in the company's zone, `05/14/2026` (a day is not an instant). */
export function dayInZone(iso: string, zone: string): string {
  const wc = wallClockInZone(new Date(iso), zone);
  return formatDisplayDate(`${wc.year}-${String(wc.month).padStart(2, "0")}-${String(wc.day).padStart(2, "0")}`);
}

function verdictFor(
  item: TollTagImportItem,
  tag: TransponderDto | undefined,
  vehicles: readonly ImportVehicle[],
  now: Date,
  zone: string,
): TollTagImportVerdict {
  const day = (iso: string) => dayInZone(iso, zone);
  const matches = findVehicle(vehicles, item.unitNumber);
  if (matches.length === 0) return { kind: "refused", reason: `No truck ${item.unitNumber} in the fleet. Check the unit number.` };
  if (matches.length > 1) return { kind: "refused", reason: `More than one truck matches ${item.unitNumber}. Type the unit number exactly as it is on the Vehicles list.` };
  const truck = matches[0]!;
  if (!truck.inService) {
    return { kind: "refused", reason: `Unit ${truck.unitNumber} is not in service. Enter its tags on its truck page, with the day each came off.` };
  }
  if (Date.parse(item.at) > now.getTime()) return { kind: "refused", reason: "That day is in the future." };
  if (!tag) return { kind: "add", vehicleId: truck.id };

  if (tag.retiredAt) return { kind: "refused", reason: `This tag was retired ${day(tag.retiredAt)}. A retired tag never goes back on a truck.` };
  const live = tag.history.filter((h) => h.voidedAt == null);
  const open = live.find((h) => h.validTo == null);
  const at = Date.parse(item.at);

  if (open && open.vehicleId === truck.id) {
    if (Date.parse(open.validFrom) <= at) return { kind: "unchanged", transponderId: tag.id, since: open.validFrom };
    // Starting earlier on the same truck: the open entry is replaced, so only the OTHER entries can clash.
    const clash = live.find((h) => h.id !== open.id && h.validTo != null && Date.parse(h.validTo) > at);
    if (clash) {
      return {
        kind: "refused",
        reason: `This tag was on unit ${clash.unitNumber ?? "?"} until ${day(clash.validTo!)}, after that day. If that entry is wrong, correct it on unit ${clash.unitNumber ?? "?"}'s page first.`,
      };
    }
    return { kind: "backdate", vehicleId: truck.id, transponderId: tag.id, entryId: open.id, previousFrom: open.validFrom };
  }
  if (open && Date.parse(open.validFrom) >= at) {
    return {
      kind: "refused",
      reason: `This tag is on unit ${open.unitNumber ?? "?"} since ${day(open.validFrom)}, later than this day. If that entry is wrong, correct it on unit ${open.unitNumber ?? "?"}'s page first.`,
    };
  }
  const lastEnd = live.filter((h) => h.validTo != null).sort((a, b) => Date.parse(b.validTo!) - Date.parse(a.validTo!))[0];
  if (!open && lastEnd && Date.parse(lastEnd.validTo!) > at) {
    return {
      kind: "refused",
      reason: `This tag was on unit ${lastEnd.unitNumber ?? "?"} until ${day(lastEnd.validTo!)}, after this day. If that entry is wrong, correct it on unit ${lastEnd.unitNumber ?? "?"}'s page first.`,
    };
  }
  return { kind: "move", vehicleId: truck.id, transponderId: tag.id, fromUnit: open?.unitNumber ?? null };
}

export function planTollTagImport(
  items: readonly TollTagImportItem[],
  ctx: { tags: readonly TransponderDto[]; vehicles: readonly ImportVehicle[]; now: Date; zone: string },
): PlannedTollTagLine[] {
  const byKey = new Map<string, TransponderDto>();
  for (const t of ctx.tags) {
    const k = tollTagKey(t.provider, t.tagNumber);
    if (k) byKey.set(k, t);
  }
  const linesOf = new Map<string, number[]>();
  for (const it of items) {
    const k = tollTagKey(it.provider, it.tagNumber) ?? `${it.provider}:${it.tagNumber}`;
    linesOf.set(k, [...(linesOf.get(k) ?? []), it.line]);
  }
  return items.map((item) => {
    const k = tollTagKey(item.provider, item.tagNumber) ?? `${item.provider}:${item.tagNumber}`;
    const others = (linesOf.get(k) ?? []).filter((l) => l !== item.line);
    if (others.length) {
      return {
        item,
        verdict: {
          kind: "refused",
          reason: `This ${TOLL_PROVIDER_LABEL[item.provider]} tag is also on line ${others.join(", ")}. Keep one line per tag; a tag that moved trucks is moved on the truck page.`,
        },
      };
    }
    return { item, verdict: verdictFor(item, byKey.get(k), ctx.vehicles, ctx.now, ctx.zone) };
  });
}

// ── The contract: POST /api/tolls/transponders/import ───────────────────────────────────────

/** Lines per request. The browser sends a long sheet in parts of this size and shows its progress. */
export const TOLL_TAG_IMPORT_BATCH = 50;

export const tollTagImportSchema = z.object({
  rows: z
    .array(
      z.object({
        line: z.number().int().min(1),
        unitNumber: z.string().trim().min(1).max(40),
        provider: tollProviderSchema,
        tagNumber: z.string().transform((s, ctx) => {
          const n = normaliseTagNumber(s);
          if (n == null) {
            ctx.addIssue({ code: "custom", message: "A tag number is 4 to 24 letters and digits." });
            return z.NEVER;
          }
          return n;
        }),
        at: z.iso.datetime({ offset: true }),
        issuer: z.string().trim().min(1).max(64).nullish(),
      }),
    )
    .min(1)
    .max(TOLL_TAG_IMPORT_BATCH),
});
export type TollTagImport = z.infer<typeof tollTagImportSchema>;

export type TollTagImportOutcome = "added" | "moved" | "backdated" | "unchanged" | "refused";

export interface TollTagImportResult {
  line: number;
  outcome: TollTagImportOutcome;
  /** Why, when refused; null otherwise. */
  message: string | null;
}
