import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import ApplicantIdentityOnFile from "@/features/recruitment/ApplicantIdentityOnFile.vue";

/**
 * The applicant's date of birth and licence on the Permissions step (AF3, D-AF8): shown as screening will
 * use them, and corrected on the application's card (F3c part 2, step 6) — one editor of the three, not two.
 */
const role = vi.hoisted(() => ({ value: "recruiter" as string }));
// `can` is the real matrix over a mocked role — the button asks `session.can("recruitment")` (SP5).
vi.mock("@/stores/session", async () => {
  const { canManageSection } = await import("@silvicom/shared");
  return {
    useSessionStore: () => ({
      get role() { return role.value; },
      can: (s: string) => canManageSection(role.value as never, s as never),
    }),
  };
});

const ON_FILE = { date_of_birth: "1980-04-02", cdl_number: "PA334554", cdl_state: "PA" };
const mountIt = (identity: typeof ON_FILE | null = ON_FILE) => mount(ApplicantIdentityOnFile, { props: { identity } });
const button = (w: ReturnType<typeof mountIt>) => w.findAll("button")[0];

beforeEach(() => { role.value = "recruiter"; });

describe("the date of birth and licence on the Permissions step", () => {
  it("lists date of birth, licence number and state as labelled facts, the date as the product writes dates (D-US6)", () => {
    const w = mountIt();
    expect(w.findAll("dt").map((d) => d.text())).toEqual(["Date of birth", "Licence number", "State"]);
    expect(w.findAll("dd").map((d) => d.text())).toEqual(["04/02/1980", "PA334554", "PA"]);
  });

  it("⚠ offers no editor of its own: it asks for the application's card instead", async () => {
    const w = mountIt();
    expect(w.find("input").exists()).toBe(false);
    expect(button(w)!.text()).toBe("Correct them in the application");
    await button(w)!.trigger("click");
    expect(w.emitted("correct")).toHaveLength(1);
  });

  it("asks for them to be ENTERED there when none are on file, rather than showing blanks", () => {
    const w = mountIt(null);
    expect(w.text()).toContain("Not given yet");
    expect(button(w)!.text()).toBe("Enter them in the application");
  });

  /** ⚠ The route refuses a reader with a 403, so the button is not offered to somebody it would refuse. */
  it("offers a reader the values and no way to change them", () => {
    role.value = "auditor";
    const w = mountIt();
    expect(w.text()).toContain("PA334554");
    expect(w.find("button").exists()).toBe(false);
  });
});
