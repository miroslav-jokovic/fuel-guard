/**
 * The truck page's sections (UNIT-FILES-PLAN UF5), on `driverSections.ts`'s model: `?section=` is an
 * ANCHOR the page scrolls to, not a tab that hides the rest (D-ROS5). A link into the File section —
 * from a Vehicles-list cell, a binder reference, a roadside alert — lands on the file with the rest of
 * the truck around it, and a `?section=` nobody recognises lands on the overview rather than nowhere.
 *
 * Its own module so the vocabulary can be asserted without mounting a page that owns six queries.
 */
export const VEHICLE_SECTIONS = [
  { value: "overview", label: "Overview" },
  { value: "file", label: "File" },
  { value: "maintenance", label: "Maintenance" },
  { value: "fuel", label: "Fuel" },
] as const;

export type VehicleSection = (typeof VEHICLE_SECTIONS)[number]["value"];

const VALUES = new Set<string>(VEHICLE_SECTIONS.map((s) => s.value));

/** Anything unrecognised is the overview — an old or mistyped link lands somewhere, never on a blank page. */
export function resolveVehicleSection(raw: unknown): VehicleSection {
  const s = String(raw ?? "");
  return VALUES.has(s) ? (s as VehicleSection) : "overview";
}
