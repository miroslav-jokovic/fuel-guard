/**
 * The tutorials' one synthetic carrier — "Demo Freight Co." — from which every stubbed answer is
 * projected (`endpoints.ts`).
 *
 * ── ONE WORLD, NOT ONE FIXTURE PER ENDPOINT ─────────────────────────────────────────────────────
 * A dispatcher watching the Dispatch board tutorial and then the Live map one must meet the SAME truck
 * 1042 hauling the SAME load to the SAME city, or the tutorials teach that the pages disagree. So the
 * fleet is described once, here, as trucks and loads, and the board rows, the map's vehicles and the
 * Loads list are all derived from it. A fixture per endpoint would be four copies of one fleet.
 *
 * ── SYNTHETIC, AND SAYS SO ──────────────────────────────────────────────────────────────────────
 * Every name — the company, the customers, the drivers, the dispatchers — is invented, and the email
 * domain is `.example` (RFC 2606), which can never deliver. Only the CITIES are real, because a map of
 * invented places teaches nobody where their trucks are. Nothing here is copied from any database.
 *
 * ── ONE CLOCK ───────────────────────────────────────────────────────────────────────────────────
 * Every time is an offset from `NOW`, and the browser's clock is pinned to it (`session.ts`), so an
 * "ETA in 3 h" reads the same on every regeneration and a re-recorded video differs only where the
 * product did.
 */

/** Tuesday 10:30 a.m. Central — mid-shift, when a board has something to say. */
export const NOW = Date.parse("2026-10-27T15:30:00.000Z");
export const TIMEZONE = "America/Chicago";
const H = 3_600_000;
export const at = (hours: number): string => new Date(NOW + hours * H).toISOString();

export interface Place {
  name: string;
  city: string;
  state: string;
  postalCode: string;
  lat: number;
  lng: number;
}

const place = (name: string, city: string, state: string, postalCode: string, lat: number, lng: number): Place => ({
  name, city, state, postalCode, lat, lng,
});

/** Invented customers in real cities. */
export const PLACES = {
  joliet: place("Prairie Paper Co.", "Joliet", "IL", "60436", 41.525, -88.0817),
  columbus: place("Buckeye Beverage DC", "Columbus", "OH", "43215", 39.9612, -82.9988),
  indianapolis: place("Hoosier Plastics", "Indianapolis", "IN", "46225", 39.7684, -86.1581),
  louisville: place("Riverbend Grocers DC", "Louisville", "KY", "40202", 38.2527, -85.7585),
  stLouis: place("Gateway Cold Storage", "St. Louis", "MO", "63102", 38.627, -90.1994),
  milwaukee: place("Northwoods Packaging", "Milwaukee", "WI", "53202", 43.0389, -87.9065),
  desMoines: place("Heartland Feed Supply", "Des Moines", "IA", "50309", 41.5868, -93.625),
  kansasCity: place("Plains Hardware DC", "Kansas City", "MO", "64105", 39.0997, -94.5786),
  detroit: place("Motor City Parts", "Detroit", "MI", "48226", 42.3314, -83.0458),
  memphis: place("Delta Distribution", "Memphis", "TN", "38103", 35.1495, -90.049),
  nashville: place("Music Row Foods", "Nashville", "TN", "37203", 36.1627, -86.7816),
  minneapolis: place("North Star Grocers", "Minneapolis", "MN", "55401", 44.9778, -93.265),
  cincinnati: place("Queen City Chemical", "Cincinnati", "OH", "45202", 39.1031, -84.512),
  peoria: place("Riverfront Steel Supply", "Peoria", "IL", "61602", 40.6936, -89.589),
  fortWayne: place("Summit City Paper", "Fort Wayne", "IN", "46802", 41.0793, -85.1394),
  gary: place("Lakeshore Foods DC", "Gary", "IN", "46402", 41.5934, -87.3464),
} as const;

export const ORG = { id: "00000000-0000-4000-8000-00000000d001", name: "Demo Freight Co." };

/** The person the tutorials are recorded as: a dispatcher, linked to McLeod login DANA. */
export const DISPATCHER = {
  userId: "00000000-0000-4000-8000-00000000c001",
  email: "dana.reyes@demo-freight.example",
  fullName: "Dana Reyes",
  mcleodId: "DANA",
  fleet: "NORTH",
};

export const DISPATCHERS = [
  { id: "DANA", name: "Dana Reyes", isSystem: false },
  { id: "MARCUS", name: "Marcus Bell", isSystem: false },
];
export const FLEETS = [
  { code: "NORTH", dispatcherId: "DANA" },
  { code: "SOUTH", dispatcherId: "MARCUS" },
];

export type TruckStory =
  | "on_time"
  | "at_risk"
  | "late"
  | "empty"
  | "shop"
  | "no_gps";

export interface Warning {
  unit: "driver" | "truck" | "trailer";
  kind: "random_test" | "medical_card" | "cdl" | "annual" | "six_month" | "oil" | "repair_order";
  verdict: "overdue" | "due";
  dueInDays: number | null;
  milesLeft: number | null;
}

export interface LoadPlan {
  ref: string;
  customer: string;
  commodity: string;
  hazmat: boolean;
  pickup: Place;
  delivery: Place;
  /** Hours from NOW: pickup appointment, delivery appointment. */
  pickupAt: number;
  deliverAt: number;
  miles: number;
  trailer: string;
}

export interface Truck {
  unit: string;
  driver: string | null;
  fleet: "NORTH" | "SOUTH";
  story: TruckStory;
  /** 0..1 along the current load's line; for an empty truck, where it stands is `parkedAt`. */
  progress: number;
  parkedAt?: Place;
  speedMph: number;
  fuelPercent: number;
  /** Drive hours left on the driver's clock. */
  driveHoursLeft: number;
  current: LoadPlan | null;
  next: LoadPlan | null;
  warnings: Warning[];
}

const load = (
  ref: string, customer: string, commodity: string, pickup: Place, delivery: Place,
  pickupAt: number, deliverAt: number, miles: number, trailer: string, hazmat = false,
): LoadPlan => ({ ref, customer, commodity, hazmat, pickup, delivery, pickupAt, deliverAt, miles, trailer });

const P = PLACES;

/**
 * Twelve trucks, each chosen to show one thing the board does — on time, at risk, late, empty with
 * nothing next, in the shop, warnings due, no GPS — so a tutorial can point at it by unit number.
 */
export const TRUCKS: Truck[] = [
  {
    unit: "1042", driver: "Maria Alvarez", fleet: "NORTH", story: "on_time", progress: 0.55, speedMph: 63, fuelPercent: 71, driveHoursLeft: 6.5,
    current: load("DF-20418", "Buckeye Beverage", "Bottled water", P.joliet, P.columbus, -5, 4, 355, "T-5310"),
    next: load("DF-20433", "Queen City Chemical", "Cleaning compound (NA1760)", P.cincinnati, P.joliet, 22, 30, 300, "T-5310", true),
    warnings: [],
  },
  {
    unit: "1057", driver: "James Whitfield", fleet: "NORTH", story: "at_risk", progress: 0.4, speedMph: 58, fuelPercent: 38, driveHoursLeft: 1.6,
    current: load("DF-20421", "Gateway Cold Storage", "Frozen poultry", P.milwaukee, P.stLouis, -4, 3.5, 375, "R-7702"),
    next: null,
    warnings: [],
  },
  {
    unit: "1063", driver: "Priya Natarajan", fleet: "NORTH", story: "late", progress: 0.3, speedMph: 0, fuelPercent: 54, driveHoursLeft: 4,
    current: load("DF-20409", "Motor City Parts", "Auto parts", P.fortWayne, P.detroit, -3, 0.5, 160, "T-5288"),
    next: load("DF-20440", "Summit City Paper", "Paper rolls", P.detroit, P.fortWayne, 8, 13, 160, "T-5288"),
    warnings: [],
  },
  {
    unit: "1071", driver: "Tomasz Nowak", fleet: "NORTH", story: "empty", progress: 0, parkedAt: P.indianapolis, speedMph: 0, fuelPercent: 82, driveHoursLeft: 11,
    current: null, next: null,
    warnings: [],
  },
  {
    unit: "1088", driver: null, fleet: "NORTH", story: "shop", progress: 0, parkedAt: P.joliet, speedMph: 0, fuelPercent: 45, driveHoursLeft: 11,
    current: null, next: null,
    warnings: [{ unit: "truck", kind: "repair_order", verdict: "due", dueInDays: null, milesLeft: null }],
  },
  {
    unit: "1090", driver: "Kevin O'Brien", fleet: "NORTH", story: "on_time", progress: 0.7, speedMph: 61, fuelPercent: 27, driveHoursLeft: 5,
    current: load("DF-20425", "Lakeshore Foods", "Canned goods", P.peoria, P.gary, -3, 1.5, 175, "T-5321"),
    next: load("DF-20444", "Northwoods Packaging", "Corrugated boxes", P.gary, P.milwaukee, 5, 9, 105, "T-5321"),
    warnings: [
      { unit: "driver", kind: "medical_card", verdict: "due", dueInDays: 12, milesLeft: null },
      { unit: "truck", kind: "annual", verdict: "overdue", dueInDays: -3, milesLeft: null },
    ],
  },
  {
    unit: "1103", driver: "Andre Thompson", fleet: "NORTH", story: "no_gps", progress: 0.5, speedMph: 0, fuelPercent: 60, driveHoursLeft: 7,
    current: load("DF-20429", "Heartland Feed Supply", "Animal feed", P.joliet, P.desMoines, -2, 6, 320, "T-5302"),
    next: null,
    warnings: [],
  },
  {
    unit: "1115", driver: "Grace Kim", fleet: "SOUTH", story: "on_time", progress: 0.25, speedMph: 66, fuelPercent: 88, driveHoursLeft: 9,
    current: load("DF-20431", "Delta Distribution", "Paper towels", P.stLouis, P.memphis, -1.5, 3.5, 285, "T-5277"),
    next: load("DF-20446", "Music Row Foods", "Dry groceries", P.memphis, P.nashville, 6, 10, 212, "T-5277"),
    warnings: [],
  },
  {
    unit: "1122", driver: "Luis Herrera", fleet: "SOUTH", story: "on_time", progress: 0.6, speedMph: 64, fuelPercent: 49, driveHoursLeft: 6,
    current: load("DF-20414", "Riverbend Grocers", "Fresh produce", P.indianapolis, P.louisville, -2, 1, 115, "R-7715"),
    next: null,
    warnings: [{ unit: "trailer", kind: "six_month", verdict: "due", dueInDays: 9, milesLeft: null }],
  },
  {
    unit: "1130", driver: "Hannah Schultz", fleet: "SOUTH", story: "on_time", progress: 0.45, speedMph: 62, fuelPercent: 66, driveHoursLeft: 8,
    current: load("DF-20437", "North Star Grocers", "Dairy", P.desMoines, P.minneapolis, -2.5, 2.5, 245, "R-7720"),
    next: null,
    warnings: [{ unit: "truck", kind: "oil", verdict: "due", dueInDays: null, milesLeft: 640 }],
  },
  {
    unit: "1147", driver: "Samuel Osei", fleet: "SOUTH", story: "empty", progress: 0, parkedAt: P.kansasCity, speedMph: 0, fuelPercent: 74, driveHoursLeft: 10,
    current: null,
    next: load("DF-20449", "Plains Hardware", "Hardware", P.kansasCity, P.stLouis, 3, 9, 250, "T-5266"),
    warnings: [],
  },
  {
    unit: "1152", driver: "Olivia Bennett", fleet: "SOUTH", story: "on_time", progress: 0.8, speedMph: 59, fuelPercent: 33, driveHoursLeft: 3,
    current: load("DF-20402", "Music Row Foods", "Snack foods", P.louisville, P.nashville, -3, 0.75, 175, "T-5259"),
    next: null,
    warnings: [],
  },
];

/** Loads no truck carries yet — the board counts them and links to Loads' Uncovered queue. */
export const UNCOVERED: LoadPlan[] = [
  load("DF-20451", "Prairie Paper Co.", "Paper rolls", P.joliet, P.indianapolis, 20, 26, 185, "—"),
  load("DF-20452", "Hoosier Plastics", "Plastic pellets", P.indianapolis, P.columbus, 26, 32, 175, "—"),
  load("DF-20455", "Gateway Cold Storage", "Frozen vegetables", P.stLouis, P.kansasCity, 30, 37, 250, "—"),
];

/** Delivered this week, so the Delivered queue has a history to filter. */
export const DELIVERED: Array<LoadPlan & { truck: string; driver: string }> = [
  { ...load("DF-20377", "Buckeye Beverage", "Bottled water", P.joliet, P.columbus, -50, -41, 355, "T-5310"), truck: "1042", driver: "Maria Alvarez" },
  { ...load("DF-20381", "Delta Distribution", "Paper towels", P.stLouis, P.memphis, -44, -38, 285, "T-5277"), truck: "1115", driver: "Grace Kim" },
  { ...load("DF-20390", "Motor City Parts", "Auto parts", P.fortWayne, P.detroit, -30, -26, 160, "T-5288"), truck: "1063", driver: "Priya Natarajan" },
  { ...load("DF-20395", "Lakeshore Foods", "Canned goods", P.peoria, P.gary, -26, -22, 175, "T-5321"), truck: "1090", driver: "Kevin O'Brien" },
  { ...load("DF-20398", "Riverbend Grocers", "Fresh produce", P.indianapolis, P.louisville, -20, -17, 115, "R-7715"), truck: "1122", driver: "Luis Herrera" },
];

/** Stable ids: the tutorials are regenerated, and a URL with a random id would change every time. */
export const vehicleId = (unit: string): string => `00000000-0000-4000-8000-0000000a${unit.padStart(4, "0")}`;
export const driverId = (name: string): string =>
  `00000000-0000-4000-8000-${[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16).padStart(12, "0").slice(-12)}`;
export const loadId = (ref: string): string => `00000000-0000-4000-8000-000000b${ref.replace(/\D/g, "").padStart(5, "0")}`;

/** A point `t` of the way along a straight line — near enough for a truck between two cities. */
export function along(a: Place, b: Place, t: number): { lat: number; lng: number } {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

export function bearing(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
  return Math.round(((Math.atan2(y, x) / rad) + 360) % 360);
}

/**
 * A load's road: a gently bowed line between its two cities — a road is never straight, and a ruler
 * line reads as fake. The truck is placed ON this line (`truckPosition`) and the map draws this line
 * (`loadRoute`), so the marker sits on its own route.
 */
export const ROUTE_STEPS = 24;
export function routeLine(a: Place, b: Place): { lat: number; lng: number }[] {
  const dLat = b.lat - a.lat;
  const dLng = b.lng - a.lng;
  return Array.from({ length: ROUTE_STEPS + 1 }, (_, i) => {
    const t = i / ROUTE_STEPS;
    const p = along(a, b, t);
    const bow = Math.sin(Math.PI * t) * 0.04;
    return { lat: p.lat - dLng * bow, lng: p.lng + dLat * bow };
  });
}

/** Where a truck is: `progress` of the way along its load's road, or where it stands. */
export function truckPosition(t: Truck): { lat: number; lng: number } {
  if (t.current) return routeLine(t.current.pickup, t.current.delivery)[Math.round(t.progress * ROUTE_STEPS)]!;
  const p = t.parkedAt ?? PLACES.joliet;
  return { lat: p.lat, lng: p.lng };
}
