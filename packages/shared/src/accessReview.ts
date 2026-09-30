import {
  APP_SECTIONS,
  isEditableRole,
  isEditableSection,
  resolveSectionAccess,
  sectionAccess,
  type AppSection,
  type SectionAccess,
  type SectionClaim,
} from "./auth.js";
import { USER_ROLE_LABELS, isRosterIssuedRole, type UserRole } from "./constants.js";
import { moduleEnabled, type ModuleSet } from "./entitlements.js";
import { surfaceAllowed, surfaceGateAllows, surfaceStartsOn, type Surface, type SurfaceClaim } from "./surfaces.js";
import { ADMIN_ONLY_SURFACES, GRANTABLE_SURFACES, SURFACES } from "./surfaceCatalogue.js";
import {
  ACCESS_LABELS,
  LAYER_LABELS,
  SECTION_LABELS,
  mergedSectionClaim,
  mergedSurfaceClaim,
  sectionCell,
  surfaceCell,
  type AccessLayer,
} from "./accessLayers.js";
import { csvCell, toCsvGrid } from "./csv.js";
import type { AccessReviewMember, AccessReviewState } from "./accessReviewContract.js";

/**
 * Who has access, and why (SETTINGS-PERMISSIONS-PLAN.md §4b.2 gap 7, SP10; Q-SET10).
 *
 * ── THE RULE THIS FILE KEEPS ────────────────────────────────────────────────────────────────────
 * It decides NOTHING. Every answer is asked of the functions that enforce access:
 *   · a section — `resolveSectionAccess`, the resolver `callerCanView`/`callerCanManage` wrap, which
 *     the API's `requireSection`, the router guard and the sidebar all ask; its input is the claim
 *     `custom_access_token_hook` would mint, the person's answers over their role's
 *     (`mergedSectionClaim`);
 *   · a screen — `surfaceAllowed`, the router guard's question, with `moduleEnabled` AND-ed in the
 *     way `canReachSurface` does for the sidebar and `requireModule` does in the API; its input is
 *     the claim `surfaceClaimFor` builds, `{}` for a locked role as that function returns;
 *   · which layer answered — `sectionCell`/`surfaceCell`, the precedence the Permissions page tags
 *     its rows with, so a cell on the page and a line in the file cannot disagree.
 * A review that computed its own answer would be the second opinion this programme exists to
 * remove, and the one document in the product an auditor is entitled to believe.
 *
 * ── WHO IS LISTED ───────────────────────────────────────────────────────────────────────────────
 * Office members, exactly as the Users page lists them (`isRosterIssuedRole` is the same filter):
 * a driver-app login holds no section (D-PERM8), is sent to the app before any route resolves, and
 * is offboarded from the Drivers page — listing ~200 rows of "None" would bury the answers a review
 * is for. The file says so on its first row rather than leaving an auditor to wonder.
 *
 * Suspended members (Q-SET12, 0393) are listed SEPARATELY and never among the holders: their token
 * carries no org, so today they reach nothing. What they would regain on reinstatement is shown,
 * because that is the question an admin reviewing a suspension actually asks.
 */

/** The answering layer, widened past the three a cell can hold by the four reasons no cell exists. */
export type ReviewLayer = AccessLayer | "locked" | "admin_only" | "section" | "module";

export const REVIEW_LAYER_LABELS: Record<ReviewLayer, string> = {
  ...LAYER_LABELS,
  /** An `admin` or `driver` member, or the `admin` section: fixed by D-PERM7/D-PERM8, never answered. */
  locked: "Fixed by role",
  /** Q-SET1's four screens: Users, Permissions, Card control, EFS integration. */
  admin_only: "Admin only",
  /** D-SURF2: a screen can only narrow a section, and this person's section does not reach it. */
  section: "No section access",
  /** The org has not enabled the module the screen belongs to. */
  module: "Module off",
};

/**
 * The screens a review covers, in catalogue order: every grantable one and every admin-only one.
 * Derived from the two named lists rather than restated — Card control is exactly the screen an
 * auditor asks about first, and it is admin-only rather than grantable.
 */
export const REVIEW_SCREENS: readonly Surface[] = SURFACES.filter(
  (s) => GRANTABLE_SURFACES.includes(s) || (ADMIN_ONLY_SURFACES.includes(s) && s.parent === undefined),
);

/** "Settings › Organization" for a directory's screen — two screens are called "Driver performance". */
export function reviewScreenLabel(s: Surface): string {
  const dir = s.reachedFrom ? SURFACES.find((d) => d.key === s.reachedFrom) : undefined;
  return dir ? `${dir.label} › ${s.label}` : s.label;
}

export type ReviewTarget = { kind: "section"; section: AppSection } | { kind: "screen"; surface: Surface };

export interface ReviewAnswer {
  /** Does the person have it at all — a section above `none`, a screen that opens. */
  granted: boolean;
  /** "None" / "View" / "Manage" for a section, "Open" / "Closed" for a screen. */
  answer: string;
  layer: ReviewLayer;
}

interface Claims {
  sections: SectionClaim;
  surfaces: SurfaceClaim;
}

/** The claims this member's next token (sections) and next page load (screens) will carry. */
function claimsFor(state: AccessReviewState, m: AccessReviewMember): Claims {
  // `surfaceClaimFor` answers `{}` for a locked role before reading anything; the hook mints no
  // override for one. Same here, so a stray row for an admin can never colour their answer.
  if (!isEditableRole(m.role)) return { sections: {}, surfaces: {} };
  return {
    sections: mergedSectionClaim(
      (state.roleSections[m.role] ?? {}) as SectionClaim,
      (state.userSections[m.userId] ?? {}) as SectionClaim,
    ),
    surfaces: mergedSurfaceClaim(state.roleSurfaces[m.role] ?? {}, state.userSurfaces[m.userId] ?? {}),
  };
}

export function sectionAnswer(state: AccessReviewState, m: AccessReviewMember, section: AppSection): ReviewAnswer {
  const role = m.role as UserRole;
  const access: SectionAccess = resolveSectionAccess(role, section, claimsFor(state, m).sections);
  const layer: ReviewLayer =
    !isEditableRole(role) || !isEditableSection(section)
      ? "locked"
      : sectionCell(
          sectionAccess(role, section),
          state.roleSections[role]?.[section],
          state.userSections[m.userId]?.[section],
        ).layer;
  return { granted: access !== "none", answer: ACCESS_LABELS[access], layer };
}

export function screenAnswer(
  state: AccessReviewState,
  m: AccessReviewMember,
  s: Surface,
  modules: ModuleSet = new Set(state.modules),
): ReviewAnswer {
  const role = m.role as UserRole;
  const claims = claimsFor(state, m);
  const inPlan = !s.module || moduleEnabled(modules, s.module);
  const open = inPlan && surfaceAllowed(s, role, claims.sections, claims.surfaces);
  let layer: ReviewLayer;
  if (s.gate.kind === "admin") layer = "admin_only";
  else if (!inPlan) layer = "module";
  else if (!isEditableRole(role)) layer = "locked";
  else if (!surfaceGateAllows(s, role, claims.sections)) layer = "section";
  else layer = surfaceCell(state.roleSurfaces[role]?.[s.key], state.userSurfaces[m.userId]?.[s.key], surfaceStartsOn(s, role)).layer;
  return { granted: open, answer: open ? "Open" : "Closed", layer };
}

export function reviewAnswer(state: AccessReviewState, m: AccessReviewMember, t: ReviewTarget): ReviewAnswer {
  return t.kind === "section" ? sectionAnswer(state, m, t.section) : screenAnswer(state, m, t.surface);
}

export const reviewMemberName = (m: AccessReviewMember): string => m.fullName ?? m.email ?? m.userId;

/** Office members, split by whether they can use the product today; driver-app logins left out. */
export function reviewMembers(state: AccessReviewState): {
  active: AccessReviewMember[];
  suspended: AccessReviewMember[];
} {
  const office = state.members
    .filter((m) => !isRosterIssuedRole(m.role))
    .sort((a, b) => reviewMemberName(a).localeCompare(reviewMemberName(b)));
  return { active: office.filter((m) => m.suspendedAt === null), suspended: office.filter((m) => m.suspendedAt !== null) };
}

export interface ReviewRow {
  member: AccessReviewMember;
  answer: ReviewAnswer;
}

/**
 * The reverse view for one screen or section: who has it, who does not, and — apart from both —
 * the suspended members with what reinstating them would give back.
 */
export function whoHasAccess(
  state: AccessReviewState,
  target: ReviewTarget,
): { holders: ReviewRow[]; without: ReviewRow[]; suspended: ReviewRow[] } {
  const { active, suspended } = reviewMembers(state);
  const rows = (ms: AccessReviewMember[]) => ms.map((member) => ({ member, answer: reviewAnswer(state, member, target) }));
  const all = rows(active);
  return {
    holders: all.filter((r) => r.answer.granted),
    without: all.filter((r) => !r.answer.granted),
    suspended: rows(suspended),
  };
}

export const ACCESS_REVIEW_COLUMNS = ["Name", "Email", "Role", "Type", "Item", "Key", "Answer", "Answered by"] as const;

/**
 * The access-review file: every active office member × every section and every reviewed screen,
 * the effective answer and the layer that gave it.
 *
 * `exportedOn` is passed in, already `MM/DD/YYYY` from `formatDisplayDate` on the carrier's calendar
 * day — this function has no clock (the export date is a fact about the request, not about the
 * data), which is also what lets a test pin the file byte for byte.
 *
 * The first row is a real CSV row, not a `#` comment, because it carries the org's NAME — free text
 * an admin typed — and `csvCell` is the one place that quotes and formula-guards free text.
 */
export function accessReviewCsv(
  state: AccessReviewState,
  exportedOn: string,
): { csv: string; rows: number; members: number; suspended: number } {
  const { active, suspended } = reviewMembers(state);
  const modules: ModuleSet = new Set(state.modules);
  const rows: string[][] = [];
  for (const m of active) {
    const who = [reviewMemberName(m), m.email ?? "", USER_ROLE_LABELS[m.role as UserRole] ?? m.role];
    for (const section of APP_SECTIONS) {
      const a = sectionAnswer(state, m, section);
      rows.push([...who, "Section", SECTION_LABELS[section], section, a.answer, REVIEW_LAYER_LABELS[a.layer]]);
    }
    for (const s of REVIEW_SCREENS) {
      const a = screenAnswer(state, m, s, modules);
      rows.push([...who, "Screen", reviewScreenLabel(s), s.key, a.answer, REVIEW_LAYER_LABELS[a.layer]]);
    }
  }
  const title = [
    "Access review",
    state.orgName,
    `Exported ${exportedOn}`,
    `${active.length} active members`,
    `${suspended.length} suspended (no access while suspended; not listed)`,
    "Driver-app logins are managed on the Drivers page and not listed",
  ];
  return {
    csv: [title.map(csvCell).join(","), toCsvGrid(ACCESS_REVIEW_COLUMNS, rows)].join("\r\n"),
    rows: rows.length,
    members: active.length,
    suspended: suspended.length,
  };
}
