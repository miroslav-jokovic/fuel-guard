import type { RouteRecordRaw } from "vue-router";
import { SMS_TERMS_PATH } from "@/lib/legalPaths";

/**
 * The three published legal documents (DIRECTION-B-PLAN §6 P3, D-PR9).
 *
 * ── WHY THEY ARE THEIR OWN AREA FILE AND NOT PART OF `auth.ts` ──────────────────────────────────
 * `auth.ts` is the routes the guard reads before a session exists, and its comment says so — the
 * whole reason it is separate is that a mistake in one of those records is a hole in the front door.
 * These three are public for an unrelated reason: they are the URLs Apple and Google require a
 * listing to point at, and both stores fetch them with no session and no cookie. Filing them under
 * auth would blur two different meanings of "public" in the one file where that distinction is the
 * point.
 *
 * ⚠ All three are DELIBERATELY indexable — no `noindex`. A privacy policy a search engine cannot see
 * is one a person cannot find when they need it, and Google Play's own review fetches the URL.
 *
 * They carry no `brand` meta, so `PublicLayout` heads them with the platform's own name. The placard
 * calculator sets `brand: "HazmatGuard"` because it markets one module; a privacy policy is published
 * by the company and cannot sit under a module's mark.
 */
export const legalRoutes: RouteRecordRaw[] = [
  {
    path: "/privacy",
    name: "privacy-policy",
    component: () => import("@/pages/legal/PrivacyPolicyPage.vue"),
    meta: { public: true, layout: "public", title: "Privacy policy" },
  },
  {
    path: "/terms",
    name: "terms-of-use",
    component: () => import("@/pages/legal/TermsPage.vue"),
    meta: { public: true, layout: "public", title: "Terms of use" },
  },
  /**
   * SMS-OPT-IN-PLAN D-SMS4 — the text-message programme's terms, the URL the applicant's opt-in card
   * links to and a toll-free verification names. Public and indexable for the policy's reason: the
   * reviewer fetches it with no session.
   */
  {
    path: SMS_TERMS_PATH,
    name: "sms-terms",
    component: () => import("@/pages/legal/SmsTermsPage.vue"),
    meta: { public: true, layout: "public", title: "Text message terms" },
  },
  {
    path: "/support",
    name: "support",
    component: () => import("@/pages/legal/SupportPage.vue"),
    meta: { public: true, layout: "public", title: "Support" },
  },
];
