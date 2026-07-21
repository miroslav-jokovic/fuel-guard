import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { useSessionStore } from "@/stores/session";

const routes: RouteRecordRaw[] = [
  { path: "/login", name: "login", component: () => import("@/pages/LoginPage.vue"), meta: { public: true } },
  // MFA is the ONLY authenticated route reachable at aal1 (enroll/challenge to reach aal2).
  { path: "/mfa", name: "mfa", component: () => import("@/pages/MfaPage.vue"), meta: { allowAal1: true } },
  { path: "/", name: "dashboard", component: () => import("@/pages/DashboardPage.vue"), meta: { title: "Overview" } },
];

export const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach(async (to) => {
  const session = useSessionStore();
  if (!session.initialized) await session.init();

  if (!session.isAuthenticated) {
    return to.meta.public ? true : { name: "login" };
  }
  // Authenticated but MFA not yet satisfied → only the MFA page is allowed.
  if (!session.isMfaSatisfied) {
    return to.meta.allowAal1 ? true : { name: "mfa" };
  }
  // Fully authenticated (aal2): bounce away from the auth/mfa pages.
  if (to.name === "login" || to.name === "mfa") return { name: "dashboard" };
  return true;
});
