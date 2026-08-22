/**
 * The driver page's tabs (DQF plan D1, split in UI plan U6 / D-UI7).
 *
 * Extracted from the SFC so the `?section=` vocabulary can be asserted without mounting a page that
 * owns four feature sections, a chart and six queries. That query string is a PUBLIC SURFACE: it is
 * what `/compliance/:id` redirects into, what the applicant board and the inquiry queue link to, and
 * what is sitting in somebody's bookmarks and in binder references.
 */
export const DRIVER_SECTIONS = [
  { value: "profile", label: "Profile" },
  { value: "qualification", label: "Qualification" },
  { value: "application", label: "Application" },
  { value: "employment", label: "Employment" },
  { value: "screening", label: "Screening" },
  { value: "fuel", label: "Fuel" },
] as const;

export type DriverSection = (typeof DRIVER_SECTIONS)[number]["value"];

const VALUES = new Set<string>(DRIVER_SECTIONS.map((s) => s.value));

/**
 * ⚠ Anything unrecognised falls back to `profile` rather than rendering an empty page. An old link
 * to a section that no longer exists should land somewhere, not nowhere — and U6 renamed nothing, so
 * today the only way here is a typo or a link from a future the app has not shipped.
 */
export function resolveDriverSection(raw: unknown): DriverSection {
  const s = String(raw ?? "");
  return VALUES.has(s) ? (s as DriverSection) : "profile";
}
