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

/**
 * Sections whose CONTENT moved to the recruitment surface at R7 (D-ROS6).
 *
 * ── WHY THE VALUES STAY IN THE VOCABULARY ────────────────────────────────────────────────────────
 * `?section=` is a public surface. `application`, `employment` and `screening` are in bookmarks, in
 * binder references, and in two links this codebase ships. Deleting them from `DRIVER_SECTIONS` so
 * the driver page stops offering a tab would make `resolveDriverSection` fall back to `profile`, and
 * an old link would land silently on the wrong thing — the exact failure `driverSections.test.ts`
 * exists to prevent, which is why that file passes unchanged through R7.
 *
 * So the vocabulary is untouched and only the DESTINATION moves: the driver page redirects these
 * three onward rather than rendering them. A reader following a two-year-old link arrives where the
 * work now is, instead of at an empty tab or a page that quietly showed them something else.
 */
export const RELOCATED_DRIVER_SECTIONS = new Set<DriverSection>(["application", "employment", "screening"]);

/** Where a relocated section's content now lives, or null when the section still lives here. */
export function relocatedSectionPath(section: DriverSection, driverId: string): string | null {
  return RELOCATED_DRIVER_SECTIONS.has(section) ? `/recruitment/${driverId}` : null;
}

/** The sections the driver page still RENDERS — the vocabulary minus what R7 moved. */
export const DRIVER_PAGE_SECTIONS = DRIVER_SECTIONS.filter((s) => !RELOCATED_DRIVER_SECTIONS.has(s.value));
