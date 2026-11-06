import {
  AD_MONEY_PER,
  OPENING_EQUIPMENT,
  OPENING_STATUSES,
  openingSaveSchema,
  type OpeningSave,
  type OpeningStatus,
  type OpeningView,
} from "@silvicom/shared";
import type { BadgeTone } from "@/lib/badges";

/**
 * The Openings editor's form (Q-AD43 (b), Q-AD44 (a)), kept apart from the screen so what a save sends can be
 * tested. `openingSaveSchema` judges it, here as at the API, so the contract's own rule is what a person reads,
 * after the name of the field it is about. Nothing here restates a bound: the radius' 15–500, the pay basis
 * list and the equipment list are the contract's, and the words below are only their labels (tsc holds each
 * label map to its list, both ways).
 *
 * Pay is typed in dollars and sent in cents (`AD_MONEY_PER`'s units, D-AD1), because nobody types "62" for
 * 62 cents a mile. The area's point comes only from the place search: there is no latitude field to fill.
 */
type Equipment = (typeof OPENING_EQUIPMENT)[number];
type PayPer = (typeof AD_MONEY_PER)[number];

export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  dry_van: "Dry van",
  reefer: "Reefer",
  flatbed: "Flatbed",
  tanker: "Tanker",
  intermodal: "Intermodal",
};
export const PAY_PER_LABEL: Record<PayPer, string> = {
  mile: "Per mile",
  week: "Per week",
  year: "Per year",
  hour: "Per hour",
  day: "Per day",
  load: "Per load",
};
export const OPENING_STATUS_LABEL: Record<OpeningStatus, string> = { open: "Open", paused: "Paused", filled: "Filled", closed: "Closed" };
export const OPENING_STATUS_TONE: Record<OpeningStatus, BadgeTone> = { open: "success", paused: "warning", filled: "info", closed: "neutral" };
/** The kebab's words for moving an opening TO a status. */
export const OPENING_STATUS_ACTION: Record<OpeningStatus, string> = { open: "Reopen", paused: "Pause", filled: "Mark filled", closed: "Close" };
/** Every status but the one it is in: the door accepts any move (`setOpeningStatus`). */
export const statusMovesFrom = (status: OpeningStatus): OpeningStatus[] => OPENING_STATUSES.filter((s) => s !== status);

export interface OpeningForm {
  profile_version_id: string;
  title: string;
  headcount: string;
  pay_per: PayPer;
  pay_min: string;
  pay_max: string;
  home_time: string;
  equipment: Equipment[];
  lanes: string;
  start_date: string;
  area_label: string;
  /** Set only by picking a place from the search. */
  area_point: { latitude: number; longitude: number } | null;
  radius_miles: string;
  area_reason: string;
}

export function blankOpeningForm(): OpeningForm {
  return {
    profile_version_id: "", title: "", headcount: "", pay_per: "mile", pay_min: "", pay_max: "", home_time: "", equipment: [],
    lanes: "", start_date: "", area_label: "", area_point: null, radius_miles: "", area_reason: "",
  };
}

const dollars = (cents: number | null): string => (cents === null ? "" : (cents / 100).toFixed(2));

/** The form for the next version of a saved opening: everything as its newest version left it. */
export function openingFormFrom(o: OpeningView): OpeningForm {
  const v = o.current;
  if (!v) return blankOpeningForm();
  return {
    profile_version_id: v.profile_version_id, title: v.title, headcount: v.headcount === null ? "" : String(v.headcount),
    pay_per: v.facts.pay.per, pay_min: dollars(v.facts.pay.min_cents), pay_max: dollars(v.facts.pay.max_cents),
    home_time: v.facts.home_time, equipment: [...v.facts.equipment], lanes: v.facts.lanes ?? "", start_date: v.facts.start_date ?? "",
    area_label: v.area_label, area_point: { latitude: v.area_latitude, longitude: v.area_longitude },
    radius_miles: String(v.area_radius_miles), area_reason: v.area_reason,
  };
}

/** Which field a contract issue is about, by its path — so "Too small…" says where. */
const FIELD_LABEL: Record<string, string> = {
  profile_version_id: "Hiring profile",
  title: "Title",
  headcount: "Drivers wanted",
  "facts.pay.per": "Pay basis",
  "facts.pay.min_cents": "Pay from",
  "facts.pay.max_cents": "Pay up to",
  "facts.home_time": "Home time",
  "facts.equipment": "Equipment",
  "facts.lanes": "Lanes",
  "facts.start_date": "Start date",
  "area.label": "Area name",
  "area.latitude": "Area",
  "area.longitude": "Area",
  "area.radius_miles": "Radius",
  "area.reason": "Why this area",
};

const orNull = (s: string): string | null => (s.trim() === "" ? null : s);
const cents = (s: string): number => (s.trim() === "" ? Number.NaN : Math.round(Number(s) * 100));
const whole = (s: string): number => (s.trim() === "" ? Number.NaN : Number(s));

export type OpeningSaveAsk = { ok: true; save: OpeningSave } | { ok: false; message: string };

/** What the door is sent, or the contract's sentence after its field's name. `openingId` null makes a new opening. */
export function openingSaveFrom(form: OpeningForm, openingId: string | null): OpeningSaveAsk {
  if (form.area_point === null) return { ok: false, message: "Area: pick the yard or town from the search." };
  const parsed = openingSaveSchema.safeParse({
    opening_id: openingId,
    profile_version_id: form.profile_version_id,
    title: form.title,
    headcount: form.headcount.trim() === "" ? null : whole(form.headcount),
    facts: {
      pay: { per: form.pay_per, min_cents: cents(form.pay_min), max_cents: form.pay_max.trim() === "" ? null : cents(form.pay_max) },
      home_time: form.home_time,
      equipment: form.equipment,
      lanes: orNull(form.lanes),
      start_date: orNull(form.start_date),
    },
    area: {
      label: form.area_label, latitude: form.area_point.latitude, longitude: form.area_point.longitude,
      radius_miles: whole(form.radius_miles), reason: form.area_reason,
    },
  });
  if (parsed.success) return { ok: true, save: parsed.data };
  const issue = parsed.error.issues[0]!;
  const label = FIELD_LABEL[issue.path.join(".")];
  return { ok: false, message: label ? `${label}: ${issue.message}` : issue.message };
}
