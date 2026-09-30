import type { UserRole } from "./constants.js";

/**
 * The acts an organisation's permission matrix does NOT reach, each on one named list with its reason
 * (SETTINGS-PERMISSIONS-PLAN.md SP11; owner's ruling Q-SET11 (a), 2026-09-30).
 *
 * ── WHY A LIST RATHER THAN THE `requireRole(...)` CALLS IT REPLACES ─────────────────────────────
 * Until SP11 each of these was a literal at its route — `requireRole("admin")` thirty-odd times,
 * `requireRole("admin", "fleet_manager")` three more — and every one of them was right. What was wrong
 * was that nobody could SEE them: the Permissions page shows the matrix, the matrix does not contain
 * these, and so an admin reading the page had no way to learn that Samsara's token or the McLeod
 * ingest switch were theirs alone. A rule that is enforced and invisible reads, from outside, exactly
 * like a rule that does not exist.
 *
 * So each is named here once, with its reason, and read from here by two consumers: the API gate
 * (`requireAdminOnly(key)` / `requireRole(...DRIVER_IDENTITY_ROLES)`) and the Permissions page's
 * "Admin only" list. `routeGateLedger.test.ts` holds the two together in both directions — every key
 * here guards at least one route, and every route guarded by this gate names a key that is here — so
 * the page cannot list an act the API does not gate, or the API gate an act the page does not list.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────────────────────────
 * Not the regulatory reader tests (D-PERM9: `canReadTestingRecords`, `canReadInvestigationHistory`)
 * and not the hazmat review's separation of duties (D-PERM10: `HAZMAT_REVIEW_ROLES`). Those are role
 * lists too, but they belong to a regulation or a rule of evidence rather than to the product's
 * judgement about credentials, and each already has its home and its argument. This file is for the
 * ones that were literals with nothing but a comment beside them.
 */

/**
 * Integration setup and credentials — the acts Q-SET11 (a) put on the admin-only list beside Q-SET1's
 * four screens (Users, Permissions, Card control, EFS integration, which `ADMIN_ONLY_SURFACES` derives
 * from the catalogue).
 *
 * The common argument, and the reason none of them is a section question: each one either holds a
 * credential that speaks for the whole carrier to somebody else's system, or rewrites data other
 * people's work is built on from a source only the admin configures. An org that could grant one to a
 * dispatcher through the matrix would be granting the vendor account, not a page. The admin ROLE is
 * not editable (D-PERM7), so "admin only" here means exactly one thing and cannot drift.
 *
 * ⚠ Behaviour did not change when this list was introduced: every route it now guards was
 * `requireRole("admin")` before. Moving one OFF this list is a permission decision and needs a ruling.
 */
export const ADMIN_ONLY_CAPABILITIES = [
  {
    key: "samsara.connection",
    label: "Samsara connection and fleet sync",
    why: "Stores the carrier's Samsara API token and rewrites vehicles, trailers and drivers from it; the diagnostics read the account behind that token.",
  },
  {
    key: "mcleod.connection",
    label: "McLeod connection",
    why: "Issues and revokes the ingest token the on-site agent authenticates with, and chooses which system is the roster's master.",
  },
  {
    key: "efs.connection",
    label: "EFS connection and account diagnostics",
    why: "Holds the EFS login and client certificate, and reads the whole card account with them.",
  },
  {
    key: "efs.card-control",
    label: "Card control and card-write proofs",
    why: "Decides who may change a real fuel card, and runs the proofs that write to one. Every write here also asks for a fresh sign-in.",
  },
  {
    key: "efs.unit-mileage",
    label: "Fuel-card odometer correction",
    why: "Overwrites the odometer EFS holds for a unit, using the EFS login; a wrong baseline can strand a truck at the pump.",
  },
  {
    key: "posted-prices.networks",
    label: "Fuel-network price feeds",
    why: "Rewrites the station registry and posted prices every organisation's fuel planning reads, not only this one's.",
  },
  {
    key: "performance.rewards-freeze",
    label: "Driver-performance rewards freeze",
    why: "Freezes settled weeks into the rewards ledger; a frozen week is what a bonus is paid on and is not recomputed afterwards.",
  },
  {
    key: "hazmat.policy",
    label: "HazmatGuard policy",
    why: "Sets the organisation-wide rules every hazmat load is analysed against; the database's own write policy is admin-only too.",
  },
] as const satisfies readonly { key: string; label: string; why: string }[];

export type AdminOnlyCapability = (typeof ADMIN_ONLY_CAPABILITIES)[number]["key"];

export const isAdminOnlyCapability = (key: string): key is AdminOnlyCapability =>
  ADMIN_ONLY_CAPABILITIES.some((c) => c.key === key);

/**
 * Who may issue a driver's app login, and fold one driver record into another — granted by NAME, and
 * deliberately narrower than `rolesThatManage("roster")`, which gained `safety_manager` in the D-ROS12
 * split (DRIVER-ROSTER-PLAN.md).
 *
 * Both acts are ones a section is the wrong unit for:
 *  · **A login is a credential handed to a person once**, and it cannot be un-handed — disabling it
 *    later does not undo whatever was done with it in between (`roster/routes/credentials.ts`).
 *  · **A merge is irreversible.** `merge_driver()` moves every fuel, idle, HOS and qualification row
 *    off one driver onto another, and there is no un-merge (`roster/routes/drivers.ts` `/reconcile`,
 *    `/:id/merge`).
 * The split must not widen either to the safety manager as a side effect of a rename; if that grant is
 * ever wanted it is a decision somebody makes on its own, here, in writing (SP11 moved these lists
 * here from three route literals without changing who is on them).
 */
export const DRIVER_IDENTITY_ROLES = ["admin", "fleet_manager"] as const satisfies readonly UserRole[];

export const canManageDriverIdentity = (role: UserRole | null | undefined): boolean =>
  !!role && (DRIVER_IDENTITY_ROLES as readonly string[]).includes(role);
