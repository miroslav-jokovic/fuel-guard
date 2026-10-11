import {
  callerCanManage,
  callerCanView,
  isAdmin,
  isReadOnly,
  type AppSection,
  type SectionClaim,
  type SurfaceClaim,
  type UserRole,
} from "@silvicom/shared";

/**
 * A session store stand-in with the REAL shape the gates read — for component tests (SP5).
 *
 * SP5 put every link and button in front of the router guard's own question (`useOpens`, which reads
 * `role`, `admin`, `sections` and `surfaces`) or the endpoint's (`can`/`canView`). A mock that answers
 * `can: () => true` and nothing else can no longer say whether a link shows, and a hand-set boolean per
 * test would be a second copy of the matrix. So this derives every answer from the same shared
 * functions the store calls — `callerCanManage` layers `sections` over the shipped matrix exactly as
 * `stores/session.ts` does — and a test changes WHO is signed in, never what the rules are.
 *
 * Mutable on purpose: a test sets `role`, `sections` or `surfaces` and the getters follow.
 */
export interface FakeSession {
  role: UserRole | null;
  sections: SectionClaim | null;
  surfaces: SurfaceClaim | null;
  readonly admin: boolean;
  readonly readOnly: boolean;
  can: (section: AppSection) => boolean;
  canView: (section: AppSection) => boolean;
}

export function fakeSession(role: UserRole | null = "admin"): FakeSession {
  const s: FakeSession = {
    role,
    sections: null,
    surfaces: null,
    get admin() {
      return isAdmin(s.role);
    },
    get readOnly() {
      return isReadOnly(s.role);
    },
    can: (section) => callerCanManage(s.role, section, s.sections),
    canView: (section) => callerCanView(s.role, section, s.sections),
  };
  return s;
}
