import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { ROUTE_TABLE } from "@/router/table";

/**
 * `useOpens()` turns anything `RouterLink :to` accepts into the guard's answer (SP5, plan §4b). What
 * `pathOpens` got wrong, and these exist to pin, is RESOLUTION: it exact-matched the path, so a
 * detail URL or a query string answered "no" for everyone.
 *
 * The session mock is the real shape the guard reads — `role`, `admin`, `sections`, `surfaces`.
 */
const session = vi.hoisted(() => ({
  role: "fleet_manager" as string | null,
  admin: false,
  sections: null as Record<string, string> | null,
  surfaces: null as Record<string, boolean> | null,
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => session }));

const { useOpens } = await import("./useOpens");

beforeEach(() => {
  session.role = "fleet_manager";
  session.admin = false;
  session.sections = null;
  session.surfaces = null;
});

describe("useOpens, resolving without an installed router", () => {
  it("judges /vehicles/abc as /vehicles/:id rather than refusing an unknown literal", () => {
    expect(useOpens()("/vehicles/abc")).toBe(true);
  });

  it("ignores a query string", () => {
    expect(useOpens()("/fuel-log?tab=declines")).toBe(true);
    expect(useOpens()({ path: "/anomalies", query: { vehicle: "v1" } })).toBe(true);
  });

  it("answers false for a person whose screen is switched off, on the detail route too", () => {
    session.surfaces = { "fleet.vehicles": false };
    expect(useOpens()("/vehicles")).toBe(false);
    expect(useOpens()("/vehicles/abc")).toBe(false);
  });

  it("answers false for an address the table does not know", () => {
    expect(useOpens()("/nowhere/at/all")).toBe(false);
  });

  it("refuses a requiresAdmin route to a non-admin and opens it to the admin", () => {
    expect(useOpens()("/settings/users")).toBe(false);
    session.role = "admin";
    session.admin = true;
    expect(useOpens()("/settings/users")).toBe(true);
  });

  it("opens an uncatalogued route (a public page) as the guard does", () => {
    expect(useOpens()("/error")).toBe(true);
  });

  it("follows a redirect to the page the guard will actually be asked about", () => {
    // `/fuel-spend/exceptions` redirects to `/fuel-problems` (fuel view); a technician holds no fuel.
    session.role = "technician";
    expect(useOpens()("/fuel-spend/exceptions")).toBe(false);
    session.role = "fleet_manager";
    expect(useOpens()("/fuel-spend/exceptions")).toBe(true);
  });
});

describe("useOpens, inside a component with the app's router installed", () => {
  it("resolves named locations through the injected router", () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [...ROUTE_TABLE] });
    let opens: ReturnType<typeof useOpens> | null = null;
    mount(defineComponent({ setup() { opens = useOpens(); return () => h("div"); } }), {
      global: { plugins: [router] },
    });
    expect(opens!({ name: "vehicle-detail", params: { id: "v1" } })).toBe(true);
    session.surfaces = { "fleet.vehicles": false };
    expect(opens!({ name: "vehicle-detail", params: { id: "v1" } })).toBe(false);
  });
});
