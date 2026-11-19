import type { SurfaceGroup } from "./surfaces.js";

/**
 * The sidebar's sections, apart from the screens in them (`surfaceCatalogue.ts`). Moved out on 2026-11-19 when the
 * Ads section (Q-APX18 (a)) took the catalogue past its 500 lines: a group is a heading the screens point at by key,
 * not a screen, and nothing that reads the catalogue's `SURFACES` literal (`check-surfaces.mjs`) reads this list.
 *
 * Group order IS sidebar order — by how many people open a section every day, since the sidebar
 * redesign (D-SB4, owner 2026-11-01; `docs/plans/design-system/SIDEBAR-REDESIGN-PLAN.md`). Admin is the
 * `footer` group: it is drawn below the scrolling list, beside the account, never inside it.
 */
export const SURFACE_GROUPS: readonly SurfaceGroup[] = [
  { key: "top", label: null },
  { key: "dispatch", label: "Dispatch" },
  { key: "fuel", label: "Fuel" },
  { key: "safety", label: "Safety" },
  { key: "recruitment", label: "Recruitment" },
  // Q-APX18 (a), owner 2026-11-18: the Ads workspace is its own section, right after the one its doors answer to.
  { key: "ads", label: "Ads" },
  { key: "fleet", label: "Fleet" },
  { key: "maintenance", label: "Maintenance" },
  { key: "finance", label: "Finance" },
  { key: "admin", label: "Admin", footer: true },
];
