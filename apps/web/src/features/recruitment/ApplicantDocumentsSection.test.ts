import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { AppSelect } from "@silvicom/ui";
import type { ApplicantDocument } from "@silvicom/shared";
import ApplicantDocumentsSection from "@/features/recruitment/ApplicantDocumentsSection.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";

/**
 * The applicant record's Documents section (HIRING-WORKFLOW-AUDIT §9 P9). Pinned: the office's upload
 * files for THIS driver through the recruitment door, naming a slot and never a kind, and PUTs the bytes
 * to the URL that door signed; every row says who sent it; and a paper whose picture the API withheld
 * (Q-WF4 — an SSN card, for a recruiter) is listed with no picture and no link. The org is the API's to
 * scope (`applicantDocuments.test.ts`, `expectOrgScoped`): the browser never names one.
 */
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const state = vi.hoisted(() => ({
  docs: [] as unknown[],
  requests: [] as Array<{ url: string; method: string; body: unknown }>,
  puts: [] as Array<{ path: string; token: string; type: string }>,
  canManage: true,
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string; body?: unknown }) => {
    const method = opts?.method ?? "GET";
    if (method !== "GET") {
      state.requests.push({ url, method, body: opts?.body });
      return { ok: true, data: { documentId: (opts?.body as { document_id: string }).document_id, storagePath: "org/driver/d/x.pdf", uploadUrl: "u", token: "tok" } };
    }
    return { ok: true, data: { documents: state.docs } };
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    storage: {
      from: () => ({
        uploadToSignedUrl: async (path: string, token: string, _file: File, o: { contentType: string }) => {
          state.puts.push({ path, token, type: o.contentType });
          return { error: null };
        },
      }),
    },
  },
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => state.canManage }) }));

const row = (over: Partial<ApplicantDocument>): ApplicantDocument => ({
  id: "x", slot: "twic", kind: "twic", contentType: "image/webp", at: "2026-10-30T15:00:00Z",
  source: "applicant", addedBy: null, staged: false, url: "https://signed.test/x", imageWithheld: false, ...over,
});

const settle = async (w: ReturnType<typeof mount>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};
const mountSection = () =>
  mount(ApplicantDocumentsSection, { props: { driverId: DRIVER }, global: { plugins: [VueQueryPlugin] } });

beforeEach(() => {
  setActivePinia(createPinia());
  state.docs = [];
  state.requests = [];
  state.puts = [];
  state.canManage = true;
});

describe("the office's upload on the applicant record", () => {
  it("files a dropped PDF for this driver through the recruitment door, by slot, and PUTs it to the signed URL", async () => {
    const w = mountSection();
    await settle(w);
    w.findComponent(AppSelect).vm.$emit("update:modelValue", "twic");
    await settle(w);
    const pdf = new File(["%PDF-1.7\n%%EOF\n"], "twic.pdf", { type: "application/pdf" });
    w.findComponent(FileDropzone).vm.$emit("files", [pdf]);
    await settle(w);
    expect(state.requests).toHaveLength(1);
    expect(state.requests[0]!.url).toBe(`/api/recruitment/applicants/${DRIVER}/documents`);
    expect(state.requests[0]!.body).toMatchObject({ slot: "twic", content_type: "application/pdf" });
    expect(state.requests[0]!.body).not.toHaveProperty("kind");
    expect(state.puts).toEqual([{ path: "org/driver/d/x.pdf", token: "tok", type: "application/pdf" }]);
  });

  it("offers no upload to a role that may only read the section", async () => {
    state.canManage = false;
    const w = mountSection();
    await settle(w);
    expect(w.find("[data-documents-add]").exists()).toBe(false);
  });
});

describe("the list", () => {
  it("badges each paper by who sent it", async () => {
    state.docs = [
      row({ id: "a", source: "applicant" }),
      row({ id: "b", slot: "passport", kind: "passport", source: "office", addedBy: "Dana Office" }),
    ];
    const w = mountSection();
    await settle(w);
    expect(w.find('[data-document="a"]').text()).toContain("Sent by applicant");
    expect(w.find('[data-document="b"]').text()).toContain("Added by Dana Office");
    expect(w.find('[data-document="a"]').text()).toContain("10/30/2026");
  });

  it("shows a recruiter the SSN card row and not its picture (Q-WF4)", async () => {
    state.docs = [row({ id: "ssn", slot: "ssn_card", kind: "ssn_card", url: null, imageWithheld: true })];
    const w = mountSection();
    await settle(w);
    const li = w.find('[data-document="ssn"]');
    expect(li.text()).toContain("Social Security card");
    expect(li.find("img").exists()).toBe(false);
    expect(li.find("a").exists()).toBe(false);
    expect(li.find("[data-image-withheld]").exists()).toBe(true);
  });
});
