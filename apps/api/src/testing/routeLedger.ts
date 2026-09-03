/**
 * What is deliberately open, and what deliberately does not derive — one home for both
 * (`docs/plans/permissions/SURFACE-ENTITLEMENTS-PLAN.md` S7, Q-SURF1).
 *
 * ── WHY A LEDGER RATHER THAN A COMMENT ──────────────────────────────────────────────────────────
 * S7's requirement is that every API surface "either derives from the matrix, gains a surface gate,
 * or gets a comment saying why it is open". The first two are checkable and the third is not: a
 * comment beside a route is invisible to a gate, goes stale silently, and — measured on this
 * codebase — is what let 28 sidebar entries disagree with their routes for a year. So the third
 * option is written HERE, where two fitness functions read it: `routeGates.test.ts` for mounts and
 * `routeGateLedger.test.ts` for individual routes and role lists.
 *
 * ⚠ **Every map below is SHRINK-ONLY.** Each fitness function fails on an entry it did not use, so
 * a route that gains a gate must lose its entry in the same PR. A new entry is a deliberate,
 * reviewed decision and its argument goes in the value — "TODO" and "for now" are not arguments.
 */

/**
 * Mounts that are AUTH-ONLY (or public) by design, each with the argument. Read by
 * `routeGates.test.ts`, which asks the coarser question — does this MOUNT carry any gate at all.
 *
 * It lived in that test file until S7 gave the per-route ledger below the same job at a finer grain;
 * one home for "what is deliberately open" beats two that can disagree.
 */
export const AUTH_ONLY_MOUNTS = new Map<string, string>([
  ["/api/auth", "the login exchange — public by definition; carries its own throttles + uniform errors"],
  ["/api/version", "deploy/migration probe — public deliberately; a version endpoint needing a token is one nobody checks"],
  ["/api/public/hazmat", "the public M7 calculator — anonymous by product design; stateless, no tenant data"],
  ["/api/webhooks", "provider-signed (Samsara HMAC, Twilio signature) — authenticated, just not by a user role"],
  ["/api/tms", "the on-prem agent — authenticated by the org ingest token (hash-matched), a machine credential with no role to check"],
  // R3c-2. Deliberate, and the argument is that there is no capability here to gate. A saved view is
  // a NAME plus a query string belonging to the caller: it grants nothing, reveals nothing, and
  // names no data the reader could not already reach — applying one is a navigation, and the page it
  // navigates to enforces its own permissions exactly as it does for a pasted link. What isolates
  // the rows is that every query filters on BOTH org_id and user_id (asserted in savedViews.test.ts,
  // "lists only the caller's own views, for the table asked for"), plus the RLS policy 0278 puts on
  // the table for PostgREST. A section gate here would invent a capability nobody needs: a recruiter
  // who may read the roster may certainly name a view of it.
  ["/api/saved-views", "a bookmark belonging to the caller — grants nothing and reveals nothing; isolated by org_id + user_id on every query and by 0278's RLS"],
]);

/**
 * ROUTES with no role, section, module or step-up gate anywhere in their stack, each with the
 * argument for why that is right. Keyed exactly as `METHOD /path` — the shape the walker reports.
 *
 * A route under a mount already pinned above does not need an entry; this map is for the ones inside
 * routers that ARE gated elsewhere, which is where an ungoverned endpoint actually hides. Before S7
 * they were invisible: `routeGates.test.ts` asks whether a mount carries a gate SOMEWHERE, and a
 * router with nine gated verbs and one bare one passes it.
 */
export const OPEN_ROUTES = new Map<string, string>([
  // ── The map plumbing. No tenant data passes through either. ───────────────────────────────────
  [
    "GET /api/fueling/map-config",
    "one boolean — whether a HERE key is configured — so the client knows whether to render tiles or the SVG fallback; org-agnostic and names nothing",
  ],
  [
    "GET /api/fueling/map-tiles/:z/:x/:y",
    "a raster-tile proxy that exists to keep the HERE key server-side; the bytes are public map tiles, and requireAuth is there to stop it becoming an open relay against our quota, not to protect data",
  ],

  // ── The bootstrap identity. ────────────────────────────────────────────────────────────────────
  [
    "GET /api/me",
    "who the caller is: their own user id, email, org, role and resolved screen claim, and nothing about anybody else. Every page load asks it, including the ones that then discover the caller may see almost nothing — a role gate here would be a gate on finding out what your role is",
  ],

  // ── Progress and lifecycle pings, each scoped to the caller by something other than a role. ────
  [
    "GET /api/jobs/latest",
    "the progress ping every sync and import screen polls: status + timestamps for ONE known job kind in the caller's own org. It names no row and grants nothing; the acts that CREATE those jobs are each gated, and gating this at one section would break the other sections' pages",
  ],
  [
    "POST /api/invites/accept",
    "the one act a signed-in user with NO org yet must be able to perform — requireOrg would refuse the person it is for. Authorized by the invite itself: the email must match a pending invite in an allowed domain (audit M2)",
  ],
  [
    "POST /api/me/notifications/token/revoke",
    "a driver's own device retiring its own push token on sign-out, keyed by the caller's user id; refusing it would leave a personal phone receiving load content after the person signed out (D14/D53)",
  ],

  // ── Q-FUI12, recorded rather than closed in passing. ───────────────────────────────────────────
  // These four are PRE-EXISTING reads with no role gate, and gating them is a NARROWING — it removes
  // a capability somebody may be using. FUEL-T2 pinned them in `routeGates.test.ts`'s waiver list
  // with the argument that a narrowing belongs to a step that says so out loud, and recorded them as
  // Q-FUI12 in docs/plans/fuel/FUEL-SECTION-CONSOLIDATION-PLAN.md §6. S7 does not overrule that: the
  // question has a recommendation and an owner, and answering it here would be doing so silently.
  ["GET /api/anomalies/:id/risk-context", "no role gate, requireOrg only — Q-FUI12, owner's ruling pending"],
  ["GET /api/anomalies/:id/pattern-report", "no role gate, requireOrg only — Q-FUI12, owner's ruling pending"],
  ["GET /api/anomalies/:id/history", "no role gate, requireOrg only — Q-FUI12, owner's ruling pending"],
  [
    "GET /api/fueling/statements/:id/source",
    "no role gate, requireOrg only, and it re-checks the caller's org before signing a storage URL — Q-FUI12, owner's ruling pending",
  ],
]);

/**
 * Hand-written role lists that are RIGHT as they stand, each with the argument for why the section's
 * derived set is not what this act wants.
 *
 * Keyed `<file> [<roles, sorted>]`, so the key survives the line moving and one entry covers a list
 * written identically several times in one file — which is the shape these come in: a router header
 * makes the argument once and three routes carry the same gate.
 *
 * ⚠ The rule this waives is that a literal multi-role list is a permission an org's matrix cannot
 * reach. That is Q-PERM10's finding one layer up: a list which HAPPENS to equal a section's set is
 * indistinguishable from a derived one until the org edits the matrix, at which point the derived
 * gate moves and the literal does not. So a literal list must either become `requireSection` or say
 * here why it is not a section question at all.
 */
export const ROLE_LIST_WAIVERS = new Map<string, string>([
  [
    "modules/roster/routes/credentials.ts [admin,fleet_manager]",
    "deliberately narrower than rolesThatManage('roster'), which gained safety_manager in the D-ROS12 split: issuing a driver's app login mints a credential handed to a person once and cannot be un-handed. Granted by NAME, and the router's own header makes the argument at length",
  ],
  [
    "modules/roster/routes/drivers.ts [admin,fleet_manager]",
    "the same act and the same argument as rosterCredentialsRouter — an invitation is the first half of issuing a credential, and /reconcile and /:id/merge are irreversible identity merges. Each carries the ⚠ comment saying why it is narrower than its section",
  ],
  [
    "modules/insights/routes/ai.ts [admin,auditor,dispatcher,fleet_manager,safety_manager]",
    "Ask AI is a `staff`-gated SCREEN with no section of its own (Q-SURF3), and this list is not a section's set — it equals hazmat/view by coincidence, which is exactly the trap a set comparison cannot see. What it means is 'the roles whose data the assistant can answer about'; re-pointing it is a product decision, recorded as Q-SURF7",
  ],
  [
    "modules/driver-app/routes/me.ts [driver]",
    "the driver app's own surface — a role test, not a section question. Every row it returns is scoped to the caller's own driver record",
  ],
  [
    "modules/hazmat/routes/meHazmat.ts [driver]",
    "the driver's hazmat capture surface — same role test as the rest of the driver app, and module-gated beside it",
  ],
]);
