import {
  homeTimeChipUrgent,
  wallClockInZone,
  wallClockToUtc,
  type HomeTimeChip,
  type HomeTimeDisposition,
  type HomeTimeEndReason,
  type HomeTimeState,
} from "@silvicom/shared";
import { formatDateTime } from "@/lib/format";

/**
 * How home time is worded and how its form's clock is read (HOME-TIME-PLAN §3.3, §3.4, step HT3). Every
 * VERDICT — the state, which chips, whether the truck is held — arrived from the server
 * (`@silvicom/shared` `homeTime.ts`); this file only says them, so it can be tested without a screen.
 *
 * Times are the CARRIER's (`zone`), never the viewer's: a dispatcher in Chicago and an owner travelling
 * must read the same return time.
 */

type Tone = "danger" | "warning" | "success" | "neutral" | "brand";

/** "1 d 4 h", "18 h", "40 min" — how long until, or since, an instant. Never negative: the caller says which. */
export function spanWords(ms: number): string {
  const mins = Math.max(0, Math.round(Math.abs(ms) / 60_000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days} d ${rest} h` : `${days} d`;
}

/** "11/18" — the day of an instant on the carrier's clock, from the one date definition. */
const dayShort = (iso: string, zone: string): string => formatDateTime(iso, "—", zone).slice(0, 5);

/**
 * One chip in the dispatchers' words (D-HT11). `who` names the seat on a team truck ("Ben Cole home
 * until 11/18"); on a solo truck the row's Driver column already says who, so it reads "Driver home".
 */
export function homeTimeChipWords(
  chip: HomeTimeChip,
  h: { startAt: string; expectedReturnAt: string },
  o: { now: Date; zone: string; who?: string | null },
): string {
  const who = o.who ?? null;
  switch (chip) {
    case "scheduled":
      return `${who ? `${who}: home` : "Home"} time from ${dayShort(h.startAt, o.zone)}`;
    case "home":
      return `${who ?? "Driver"} home until ${dayShort(h.expectedReturnAt, o.zone)}`;
    case "return_due":
      return `${who ? `${who} back` : "Back"} in ${spanWords(Date.parse(h.expectedReturnAt) - o.now.getTime())}`;
    case "overdue":
      return `${who ? `${who}: home` : "Home"} time overdue ${spanWords(o.now.getTime() - Date.parse(h.expectedReturnAt))}`;
    case "truck_limit":
      return `Truck at home ${Math.floor((o.now.getTime() - Date.parse(h.startAt)) / 86_400_000)} days`;
  }
}

/** Red for the two a dispatcher must act on, amber for "back soon", quiet for the rest. */
export function homeTimeChipTone(chip: HomeTimeChip): Tone {
  if (homeTimeChipUrgent(chip)) return "danger";
  return chip === "return_due" ? "warning" : "neutral";
}

export const HOME_TIME_STATE_BADGE: Record<HomeTimeState, { label: string; tone: Tone }> = {
  scheduled: { label: "Scheduled", tone: "neutral" },
  active: { label: "Home", tone: "brand" },
  overdue: { label: "Overdue", tone: "danger" },
  ended: { label: "Ended", tone: "neutral" },
  canceled: { label: "Canceled", tone: "neutral" },
};

/** Where the truck is, as a sentence about this period — the form's own labels are the shared ones. */
export const HOME_TIME_TRUCK_WORDS: Record<HomeTimeDisposition, string> = {
  with_driver: "With the driver",
  at_yard: "At the yard",
  no_truck: "No truck",
};

export const HOME_TIME_END_WORDS: Record<HomeTimeEndReason, string> = {
  returned: "Marked back",
  load_evidence: "Ended by the system: the driver was on a load",
  driver_left: "Ended by the system: the driver left the company",
};

// ── the form's clock ──────────────────────────────────────────────────────────────────────────────
// `AppDateTimeField` speaks `yyyy-MM-ddTHH:mm` with no zone. That wall time is the CARRIER's, so it is
// converted with the zone helpers both ways; `new Date(wall)` would read it on the viewer's clock.

const pad = (n: number): string => String(n).padStart(2, "0");

/** An instant as the form shows it: the carrier's wall clock, to the minute. */
export function toWallTime(iso: string, zone: string): string {
  const w = wallClockInZone(new Date(iso), zone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/** The form's wall time as an instant, or null while the field is empty or half-typed. */
export function fromWallTime(wall: string | null | undefined, zone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall ?? "");
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  return new Date(wallClockToUtc({ year: y, month: mo, day: d, hour: h, minute: mi, second: 0 }, zone)).toISOString();
}

