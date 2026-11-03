import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { mvrReportFindings, mvrReportSchema, type MvrCheckState } from "@silvicom/shared";
import MvrAiCheck from "@/features/recruitment/MvrAiCheck.vue";

/**
 * §14 OF6b (owner, 2026-11-03: "we will use AI as checking layer"). Drop the MVR → it is uploaded once as the
 * driver's MVR scan → the API reads it → the findings show, stops before checks → "Use these values" hands the
 * form what was read AND the same document id, so the record cites the checked bytes.
 */
const DRIVER = "00000000-0000-4000-8000-0000000000d1";
const net = vi.hoisted(() => ({ posts: [] as Array<{ url: string; body?: unknown }>, state: null as unknown }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string; body?: unknown }) => {
    if (opts?.method === "POST") {
      net.posts.push({ url, body: opts.body });
      return url.endsWith("/document")
        ? { ok: true, data: { documentId: "doc-mvr", uploadUrl: "u", token: "t", storagePath: "p" } }
        : { ok: true, data: { documentId: "doc-mvr" } };
    }
    return { ok: true, data: net.state };
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { storage: { from: () => ({ uploadToSignedUrl: async () => ({ error: null }) }) }, auth: { getSession: async () => ({ data: { session: null } }) } },
  DEV_BYPASS: false,
}));

const report = mvrReportSchema.parse({
  reportDate: "11/01/2026", issuer: "SambaSafety", driverName: "ANA DRIVER", licenseNumber: "D7654321", licenseState: "Illinois",
  licenseClass: "A", licenseStatus: "SUSPENDED", medicalCertificationStatus: "CERTIFIED",
  violations: [{ date: "03/04/2026", description: "SPEEDING" }],
});
const DONE: MvrCheckState = {
  status: "done", report,
  findings: mvrReportFindings(report, { fullName: "Ana Driver", cdlNumber: "D1234567", cdlState: "IL" }, "2026-11-03"),
};

const settle = async (w: ReturnType<typeof mount>) => {
  for (let i = 0; i < 12; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};
const pdf = () => new File(["%PDF-1.7 mvr"], "mvr.pdf", { type: "application/pdf" });

function mountCheck() {
  setActivePinia(createPinia());
  return mount(MvrAiCheck, { props: { driverId: DRIVER }, global: { plugins: [VueQueryPlugin] } });
}

beforeEach(() => {
  net.posts = [];
  net.state = null;
});

describe("MvrAiCheck", () => {
  it("uploads the dropped record once as the MVR scan, then asks the API to read that document", async () => {
    net.state = { status: "reading" };
    const w = mountCheck();
    w.findComponent({ name: "FileDropzone" }).vm.$emit("files", [pdf()]);
    await settle(w);
    expect(net.posts.map((p) => p.url)).toEqual([
      `/api/recruitment/applicants/${DRIVER}/records/mvr/document`,
      `/api/recruitment/applicants/${DRIVER}/mvr-check`,
    ]);
    expect(net.posts[1]!.body).toEqual({ document_id: "doc-mvr" });
    expect(w.find("[data-testid=mvr-stops]").exists()).toBe(false);
  });

  it("shows every stop before the checks, and what was read", async () => {
    net.state = DONE;
    const w = mountCheck();
    w.findComponent({ name: "FileDropzone" }).vm.$emit("files", [pdf()]);
    await settle(w);
    const stops = w.get("[data-testid=mvr-stops]").text();
    expect(stops).toContain("licence D7654321");
    expect(stops).toContain('"SUSPENDED"');
    expect(w.get("[data-testid=mvr-checks]").text()).toContain("1 violation in the last 3 years");
    expect(w.text()).toContain("SUSPENDED");
  });

  it("hands the form what was read — the date as a day, the state as its code — and the same document", async () => {
    net.state = DONE;
    const w = mountCheck();
    w.findComponent({ name: "FileDropzone" }).vm.$emit("files", [pdf()]);
    await settle(w);
    await w.get("[data-testid=mvr-use]").trigger("click");
    expect(w.emitted("use")![0]![0]).toEqual({
      documentId: "doc-mvr", occurredOn: "2026-11-01", jurisdiction: "IL",
      result: "SUSPENDED · class A · 1 violation", performedBy: "SambaSafety", reference: "",
    });
  });

  it("says so when the record could not be read, and leaves the form to the recruiter", async () => {
    net.state = { status: "failed", reason: "refused" };
    const w = mountCheck();
    w.findComponent({ name: "FileDropzone" }).vm.$emit("files", [pdf()]);
    await settle(w);
    expect(w.get("[data-testid=mvr-failed]").text()).toContain("could not be read");
    expect(w.find("[data-testid=mvr-use]").exists()).toBe(false);
  });

  it("says plainly when there is nothing to flag", async () => {
    const clean = mvrReportSchema.parse({ licenseNumber: "D1234567", licenseStatus: "VALID", medicalCertificationStatus: "CERTIFIED" });
    net.state = { status: "done", report: clean, findings: [] } satisfies MvrCheckState;
    const w = mountCheck();
    w.findComponent({ name: "FileDropzone" }).vm.$emit("files", [pdf()]);
    await settle(w);
    expect(w.get("[data-testid=mvr-clear]").text()).toContain("Nothing to flag");
  });
});
