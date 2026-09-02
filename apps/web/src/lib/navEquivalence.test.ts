import { describe, it, expect } from "vitest";
import { USER_ROLES, MODULE_KEYS, type ModuleKey, type UserRole } from "@silvicom/shared";
import { buildNavGroups } from "./nav";

/**
 * The equivalence harness for the surface-catalogue refactor
 * (`docs/plans/permissions/SURFACE-ENTITLEMENTS-PLAN.md` S1).
 *
 * `nav.ts` hand-listed 37 entries, each repeating which section it needs. S1 moves that fact into
 * `SURFACES` in `packages/shared` and makes `buildNavGroups` a fold over it, so the sidebar, the
 * router guard (S2) and the API (S3) can all read one answer instead of three copies.
 *
 * A refactor of the navigation is worth exactly nothing if it changes what one role can see, and
 * the sidebar is precisely the kind of code where a dropped entry or a swapped gate is invisible in
 * review and immediately visible to a customer. So these snapshots were captured **against the
 * hand-listed table, before the catalogue existed**. A passing run after the change is the proof
 * that nothing moved — the same argument, and the same harness shape, that `routeTable.test.ts`
 * used for the route-table split.
 *
 * ⚠ It is a FULL cross-product on purpose: 9 roles × 3 module sets, badges on and off. Snapshotting
 * one role would pin the shape and miss the gates, which are the whole content of this file. The
 * `sections` claim is exercised separately below, because that argument is what P3 added and a
 * refactor could silently stop threading it.
 */

/** Every module enabled, none, and the shipped default — the three that change what the nav shows. */
const MODULE_SETS: Array<[string, ModuleKey[] | null]> = [
  ["no-modules", []],
  ["default-modules", ["dispatch", "navigation"]],
  ["all-modules", [...MODULE_KEYS]],
];

/** A stable, readable rendering: group labels and the items under them, in order. */
function render(role: UserRole | null, modules: ModuleKey[] | null, counts = {}, sections = null) {
  const set = modules === null ? null : new Set(modules);
  return buildNavGroups(role, set, counts, sections).map((g) => ({
    group: g.label,
    items: g.items.map((i) => `${i.name} → ${i.to}${i.badge === undefined ? "" : ` [${i.badge}]`}`),
  }));
}

describe("buildNavGroups is unchanged by the surface catalogue (S1)", () => {
  for (const [modLabel, modules] of MODULE_SETS) {
    for (const role of USER_ROLES) {
      it(`${role} · ${modLabel}`, () => {
        expect(render(role, modules)).toMatchSnapshot();
      });
    }
  }

  it("a null role (signed in, no membership yet) · default-modules", () => {
    expect(render(null, ["dispatch", "navigation"])).toMatchSnapshot();
  });

  it("a null module set is not the same as an empty one", () => {
    // `modules` is null until the entitlements query resolves. `moduleEnabled(null, ...)` is the
    // shipped fallback, and a refactor that treated null as "nothing enabled" would blank the
    // dispatch group for a moment on every page load — a flicker nobody would attribute to this.
    expect(render("admin", null)).toMatchSnapshot();
  });

  it("badges are threaded through, and only when non-zero", () => {
    expect(render("admin", [...MODULE_KEYS], { hazmatReview: 4, messagesUnread: 7 })).toMatchSnapshot();
  });

  it("the sections claim still narrows and widens (P3/D-PERM2)", () => {
    // The override argument is what makes the sidebar answer the ORG's matrix rather than the
    // shipped one. It is threaded through `callerCanView`/`callerCanManage`, so a fold that
    // resolved gates without passing it would look right for every default role and be wrong for
    // exactly the orgs that had configured something.
    const narrowed = render("dispatcher", [...MODULE_KEYS], {}, { dispatch: "none" } as never);
    const widened = render("recruiter", [...MODULE_KEYS], {}, { equipment: "manage" } as never);
    expect({ narrowed, widened }).toMatchSnapshot();
  });
});
