/**
 * Shelf counting is HIDDEN (owner, 2026-10-28, Q-MX8 (a) — MAINTENANCE-SECTION-REDESIGN-PROPOSAL §7a.5).
 *
 * Our places, shelf counts and "Running low" were built at I3–I5, before the shop's parts came from
 * FleetPal (F12). FleetPal sends no quantities (D-FP11) and nobody counts shelves today, so every one
 * of those screens could only show an empty list — the owner's "not clear to me" (R4). The ruling is
 * to hide them until the shop asks, and to KEEP the code: it is built, tested and gated, and the day
 * the shop wants it this constant is the only line that changes.
 *
 * What it hides: Places, Labels and the Show › Running low filter on Shop parts; a part's Shelves
 * and History; the dashboard's "Shelves to reorder" row. The routes (`/shop/count/:id`, `/shop/labels`)
 * stay reachable — Labels prints Equipment's tags too.
 */
export const SHELF_COUNTING_SHOWN = false;
