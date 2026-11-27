import type { RouteRecordRaw } from "vue-router";

/**
 * The public careers pages (APPLY-PAGE-PLAN D-AP1, AP3), on `careers.silvicominc.com` and, with the same paths, on
 * the office host (D-AP9).
 *
 * Their own area file, for `legal.ts`'s reason: a third meaning of "public". These are not the front door (`auth.ts`)
 * and not published documents. They are a carrier's job listings, read by anyone, by Google and by Indeed. They are
 * DELIBERATELY indexable, which is the whole point of a careers page.
 *
 * Layout `apply`: the applicant's chrome, which names the carrier, offers no sign-in and makes every control 44 px
 * (`ApplyLayout.vue`). These two pages may hold no `RouterLink` outside `/careers`, because Caddy serves nothing else
 * under the careers name (`CareersJobPage.test.ts`, "every link on the page is either a /careers route or an
 * absolute address (D-AP9)").
 */
export const careersRoutes: RouteRecordRaw[] = [
  {
    path: "/careers/:handle",
    name: "careers",
    component: () => import("@/pages/CareersListPage.vue"),
    meta: { public: true, layout: "apply", title: "Careers" },
  },
  {
    path: "/careers/:handle/jobs/:openingId",
    name: "careers-job",
    component: () => import("@/pages/CareersJobPage.vue"),
    meta: { public: true, layout: "apply", title: "Job" },
  },
];
