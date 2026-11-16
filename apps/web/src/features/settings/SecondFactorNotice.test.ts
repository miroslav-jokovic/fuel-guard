import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { formatDisplayDate } from "@silvicom/shared";

/**
 * The admin's 14-day notice of two-step sign-in (INSTALLED-APP-PLAN IA-S1, Q-IA12 (b)): shown exactly when the
 * API gives a date, with the date in the house format and the way to set it up; otherwise nothing at all.
 */
const session = vi.hoisted(() => ({ secondFactor: null as null | Record<string, unknown> }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => session }));

import SecondFactorNotice from "./SecondFactorNotice.vue";
const render = () => mount(SecondFactorNotice, { global: { stubs: { RouterLink: { props: ["to"], template: "<a :data-to='to.name'><slot /></a>" } } } });

describe("the two-step sign-in notice", () => {
  it("tells an admin the day it becomes required, and where to set it up", () => {
    session.secondFactor = { required: false, satisfied: false, has_factor: false, due_from: "2026-12-01T15:00:00Z", must_keep: false };
    const w = render();
    expect(w.text()).toContain(`From ${formatDisplayDate("2026-12-01T15:00:00Z")}, admins sign in with a code`);
    expect(w.text()).not.toMatch(/2026-12-01T/);
    expect(w.find("a").attributes("data-to")).toBe("two-step");
    expect(w.find("a").text()).toBe("Set it up now");
  });

  it("draws nothing without a date: everybody else, an admin who has set it up, and an answer not yet known", () => {
    for (const s of [null, { required: false, satisfied: false, has_factor: false, due_from: null, must_keep: false }, { required: true, satisfied: true, has_factor: true, due_from: null, must_keep: false }]) {
      session.secondFactor = s;
      expect(render().text()).toBe("");
    }
  });
});
