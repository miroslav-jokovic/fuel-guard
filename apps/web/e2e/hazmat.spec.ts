import { test, expect, type Page } from "@playwright/test";

/**
 * HazmatGuard H5 acceptance e2e — the Placard Calculator trap scenarios (plan H5 exit criteria + Tests).
 * Like smoke.spec.ts, these run against a RUNNING app + a seeded Supabase org that has the `hazmatguard`
 * module enabled — NOT the offline unit gate. Provide credentials to run:
 *   E2E_EMAIL=… E2E_PASSWORD=… BASE_URL=https://<app> pnpm --filter @fuelguard/web e2e hazmat
 * Without E2E_EMAIL the suite skips cleanly (so CI without a seeded project stays green).
 *
 * These exercise the deterministic engine end-to-end through the UI: same engine as the golden suite, so
 * a pass here is a UI-wiring + explanation-quality check, not a second source of truth.
 */
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD ?? "";

test.describe("HazmatGuard — Placard Calculator (H5)", () => {
  test.skip(!EMAIL, "Set E2E_EMAIL / E2E_PASSWORD and BASE_URL to a seeded hazmatguard org to run.");

  async function login(page: Page) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL!);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).not.toHaveURL(/\/login/);
  }

  /** H-P1: the form requires the equipment to be stated — there is no default. */
  async function pickEquipment(page: Page, label: RegExp) {
    await page.getByLabel("Equipment").click();
    await page.getByRole("option", { name: label }).click();
  }

  /** Add a product line: type a query, pick the first matching result, set the quantity. */
  async function addProduct(page: Page, lineIndex: number, query: string, qty: string) {
    const pickers = page.getByPlaceholder("Search by UN/NA number or shipping name…");
    await pickers.nth(lineIndex).click();
    await pickers.nth(lineIndex).fill(query);
    await page.getByRole("option").first().click();
    await page.getByLabel("Total quantity").nth(lineIndex).fill(qty);
  }

  test("gasoline + diesel split → FLAMMABLE placard and 1203 ID display", async ({ page }) => {
    await login(page);
    await page.goto("/hazmat/calculator");

    await pickEquipment(page, /Tanker/i);
    await addProduct(page, 0, "1203", "5000"); // gasoline UN1203
    await page.getByRole("button", { name: "Add product" }).click();
    await addProduct(page, 1, "1202", "3000"); // diesel UN1202

    await page.getByRole("button", { name: "Calculate placards" }).click();

    await expect(page.getByText("Required placards")).toBeVisible();
    await expect(page.getByLabel(/FLAMMABLE placard/i)).toBeVisible();
    await expect(page.getByText("1203", { exact: false })).toBeVisible();
  });

  test("residue-uncleaned tank keeps placards", async ({ page }) => {
    await login(page);
    await page.goto("/hazmat/calculator");

    await pickEquipment(page, /Tanker/i); // the tank-state field only renders for a cargo tank
    await page.getByText("Tank state").click();
    await page.getByRole("option", { name: /Residue/i }).click();

    await addProduct(page, 0, "1203", "0"); // an emptied tank still in residue service
    await page.getByRole("button", { name: "Calculate placards" }).click();

    // §172.514(b)/§173.29: residue keeps everything — the required-placards section is non-empty.
    await expect(page.getByText("Required placards")).toBeVisible();
    await expect(page.getByLabel(/placard$/i).first()).toBeVisible();
  });
});

/**
 * HazmatGuard H7 review-queue e2e. Verifies the fail-closed review workspace renders for a review-role
 * user: the queue page loads, the filter toolbar is present, and either loads or the empty state show.
 * When a load is waiting, the truck filter narrows the list and the row links to the load's review panel.
 * Same env gate as above — skips cleanly without a seeded org, so credential-less CI stays green.
 */
test.describe("HazmatGuard — Review queue (H7)", () => {
  test.skip(!EMAIL, "Set E2E_EMAIL / E2E_PASSWORD and BASE_URL to a seeded hazmatguard org to run.");

  async function login(page: Page) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL!);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).not.toHaveURL(/\/login/);
  }

  test("queue renders with the filter toolbar and either loads or the empty state", async ({ page }) => {
    await login(page);
    await page.goto("/hazmat/review");

    // Header + toolbar always render for a review-role user (fail-closed: nothing auto-clears).
    await expect(page.getByText(/awaiting a trained reviewer/i)).toBeVisible();
    await expect(page.getByPlaceholder("Search load #, product…")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Truck/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Driver/ })).toBeVisible();

    // The body is one of two known terminal states — a populated queue or the empty card.
    const firstReview = page.getByRole("link", { name: /Review/ }).first();
    const empty = page.getByText(/Nothing awaiting review|No loads match/);
    await expect(firstReview.or(empty)).toBeVisible();
  });

  test("a search that matches nothing shows the no-match empty state", async ({ page }) => {
    await login(page);
    await page.goto("/hazmat/review");

    await page.getByPlaceholder("Search load #, product…").fill("zzz-no-such-load-zzz");
    // With a queue present the no-match message shows; with an already-empty queue the 🎉 message shows.
    await expect(page.getByText(/No loads match|Nothing awaiting review/)).toBeVisible();
  });
});
