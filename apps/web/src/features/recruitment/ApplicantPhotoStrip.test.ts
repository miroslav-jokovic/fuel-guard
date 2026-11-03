import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import { createPinia, setActivePinia } from "pinia";
import type { DocumentRow } from "@silvicom/shared";
import ApplicantPhotoStrip from "@/features/recruitment/ApplicantPhotoStrip.vue";

/**
 * §14 D-OF6 (owner, 2026-11-03): the Part 1 drawer shows every picture the applicant sent, and opens
 * it in the trucks' and trailers' gallery. The read is the driver's filed papers — the same request
 * the gallery itself makes — narrowed to the kinds the applicant's list produces.
 */
const docs = ref<DocumentRow[]>([]);
const asked: Array<[string, string | null]> = [];
vi.mock("@/composables/useCompliance", () => ({
  useDocumentsQuery: (type: { value: string }, id: { value: string | null }) => {
    asked.push([type.value, id.value]);
    return { data: docs, isLoading: ref(false), isError: ref(false), isFetching: ref(false), error: ref(null), refetch: vi.fn() };
  },
}));

const doc = (id: string, kind: string, contentType = "image/jpeg"): DocumentRow => ({
  id, subjectType: "driver", subjectId: "d1", kind, contentType, bytes: 1, sha256: "ab".repeat(32), page: 1,
  variant: "original", capturedAt: null, createdAt: `2026-11-0${id.length}T00:00:00Z`,
  url: `https://signed.test/${id}`, thumbUrl: contentType.startsWith("image/") ? `https://signed.test/${id}.thumb` : null,
  normalizedUrl: null,
});

const GalleryStub = {
  name: "FileGallery",
  props: ["subject", "subjectLabel", "startId", "kinds"],
  template: '<div v-if="subject" data-gallery :data-start="startId" :data-type="subject.type" :data-kinds="(kinds || []).join(\',\')" />',
};

function mountStrip() {
  setActivePinia(createPinia());
  return mount(ApplicantPhotoStrip, {
    props: { driverId: "d1", fullName: "Ana Driver" },
    global: { stubs: { FileGallery: GalleryStub } },
  });
}

describe("ApplicantPhotoStrip", () => {
  it("reads this driver's filed papers and shows only what the applicant sent", () => {
    docs.value = [doc("lic", "cdl"), doc("med", "medical_card"), doc("packet", "application"), doc("mvr1", "mvr", "application/pdf")];
    const w = mountStrip();
    expect(asked.at(-1)).toEqual(["driver", "d1"]);
    const labels = w.findAll("li p").map((p) => p.text());
    expect(labels).toEqual(expect.arrayContaining(["Commercial driver's licence", "Medical examiner's certificate"]));
    expect(w.findAll("[data-test=applicant-photo]")).toHaveLength(2);
  });

  it("opens the gallery on the photo pressed, narrowed to the applicant's kinds", async () => {
    docs.value = [doc("lic", "cdl"), doc("med", "medical_card")];
    const w = mountStrip();
    expect(w.find("[data-gallery]").exists()).toBe(false);
    const med = w.findAll("[data-test=applicant-photo]").find((b) => b.attributes("aria-label")?.includes("Medical"))!;
    await med.trigger("click");
    const g = w.get("[data-gallery]");
    expect(g.attributes("data-start")).toBe("med");
    expect(g.attributes("data-type")).toBe("driver");
    expect(g.attributes("data-kinds")?.split(",")).toEqual(expect.arrayContaining(["cdl", "medical_card"]));
    expect(g.attributes("data-kinds")?.split(",")).not.toContain("mvr");
  });

  it("says when nothing is filed yet, rather than an empty box", () => {
    docs.value = [];
    const w = mountStrip();
    expect(w.text()).toContain("Their photos are filed here when they finish Part 1.");
  });
});
