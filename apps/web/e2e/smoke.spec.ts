import { test, expect } from "@playwright/test";

/**
 * Critical-path smoke test (docs/03-ROADMAP.md Phase 8). Requires a running web app + a seeded
 * Supabase project (or VITE_DEV_BYPASS for the UI-only paths). Run against a deploy:
 *   BASE_URL=https://<app> pnpm --filter @silvicom/web e2e
 * Not part of the offline unit-test gate.
 */
test("unauthenticated users are redirected to login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText("Sign in to your account")).toBeVisible();
});

test("the login form is present", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible();
  // Exact: the password field's "Show password" button is also labelled with the word, and a partial
  // match finds both — which failed every production smoke run until 2026-09-28 (strict mode, 2 elements).
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

// Full path (login → log a bad fill-up → see anomaly → resolve) runs against a seeded environment;
// kept as a documented manual/CI scenario until a test Supabase project is wired into CI.
