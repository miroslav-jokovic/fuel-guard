import type { RouteRecordRaw } from "vue-router";

/**
 * Recruiting.
 *
 * These carry `requiresAuth` only, and that is now a plain choice rather than a workaround. Until R0
 * it read: "never `requiresManage`, which is `canManageFleet` (admin + fleet_manager) and would
 * bounce a recruiter to the dashboard" — a warning that the one gate available said something these
 * routes did not mean. `requiresManage` names a SECTION now, so `requiresManage: "recruitment"` is
 * available and correct; it is simply not needed, because every page here is readable by the whole
 * recruitment section and self-gates its writes.
 */
export const recruitmentRoutes: RouteRecordRaw[] = [
  {
    // Recruitment — the hiring side of §391, starting with the employment history the application
    // declares (§391.21(b)(10)) and the safety-history inquiries it obliges (§391.23(a)(2)).
    path: "/recruitment",
    name: "recruitment",
    component: () => import("@/pages/RecruitmentPage.vue"),
    meta: { requiresAuth: true, title: "Applicants" },
  },
  {
    // P0b. Shipped 2026-08-20 without this record — the page, its API and the applicant board's
    // button all existed while the URL fell through to nothing, which kept the DOB import (the fix
    // for a fleet with zero screenable drivers) unreachable. Registered 2026-08-20.
    path: "/recruitment/screening",
    name: "screening-readiness",
    component: () => import("@/pages/ScreeningReadinessPage.vue"),
    meta: { requiresAuth: true, title: "Screening Readiness", parent: "/recruitment" },
  },
  {
    // E5 — the §391.23 queue, led by our §391.23(c)(1) deadline. Same omission as above, same day.
    path: "/recruitment/inquiries",
    name: "inquiry-queue",
    component: () => import("@/pages/InquiryQueuePage.vue"),
    meta: { requiresAuth: true, title: "Inquiry Queue", parent: "/recruitment" },
  },
];
