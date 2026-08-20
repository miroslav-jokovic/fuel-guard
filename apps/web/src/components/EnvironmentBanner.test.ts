import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import EnvironmentBanner from "@/components/EnvironmentBanner.vue";

/**
 * The banner's whole job is to be right about which deployment you are on, and silent when that is
 * production.
 *
 * It exists because the UAT deployment and the production one read the SAME database, so every org
 * and every driver renders identically on both. On 2026-08-20 a PSP order was attempted on the
 * production app by an operator correctly signed in as the QA org's user — nothing on the page
 * distinguished the two, only the hostname did.
 *
 * `vi.stubEnv` reaches `import.meta.env` under Vite's test transform, so these exercise the real
 * computed rather than a re-implementation of it.
 */
afterEach(() => {
  vi.unstubAllEnvs();
});

const render = (value?: string) => {
  if (value === undefined) vi.stubEnv("VITE_APP_ENVIRONMENT", "");
  else vi.stubEnv("VITE_APP_ENVIRONMENT", value);
  return mount(EnvironmentBanner);
};

describe("EnvironmentBanner", () => {
  it("renders nothing when the variable is unset — production must not be marked", () => {
    expect(render().text()).toBe("");
  });

  it('renders nothing for "production", however it is cased', () => {
    expect(render("production").text()).toBe("");
    expect(render("Production").text()).toBe("");
  });

  it("names the deployment and says where a PSP order actually lands", () => {
    const text = render("uat").text();
    expect(text).toContain("uat");
    // The label alone only helps somebody who already knows what it implies.
    expect(text).toContain("FMCSA test account");
  });

  it("falls back to a safe statement for an environment it has no specific wording for", () => {
    const text = render("staging").text();
    expect(text).toContain("staging");
    expect(text).toContain("not the production deployment");
  });

  it("cannot be dismissed — there is no control to dismiss it with", () => {
    expect(render("uat").findAll("button")).toHaveLength(0);
  });
});
