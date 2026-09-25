import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { APPLICATION_RELEASE_ORDER, AUTHORIZATION_PURPOSE_LABELS, RECRUITMENT_TEMPLATES } from "@silvicom/shared";
import RecruitmentTemplatesPage from "@/pages/RecruitmentTemplatesPage.vue";

/**
 * The Templates tab (MV2). Pinned: every permission the link collects is on it — read from
 * `APPLICATION_RELEASE_ORDER`, so the MVR release cannot be missing from paper while present on the
 * phone — and Preview hands the viewer the template's own path, not a neighbour's.
 */
const DocumentPreviewStub = {
  name: "DocumentPreview",
  props: ["open", "label", "rendered"],
  template: "<div data-test='preview' :data-path='rendered?.path' :data-open='String(open)' />",
};

const render = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/recruitment/templates", name: "recruitment-templates", component: { template: "<div />" } }],
  });
  await router.push("/recruitment/templates");
  await router.isReady();
  return mount(RecruitmentTemplatesPage, {
    global: {
      plugins: [router],
      stubs: { DocumentPreview: DocumentPreviewStub, PageHeader: { template: "<div />" } },
    },
  });
};

describe("the templates tab", () => {
  it("lists every permission the applicant signs, the MVR release among them", async () => {
    const text = (await render()).text();
    for (const purpose of APPLICATION_RELEASE_ORDER) {
      expect(text).toContain(AUTHORIZATION_PURPOSE_LABELS[purpose]);
    }
    expect(text).toContain(AUTHORIZATION_PURPOSE_LABELS.mvr);
    expect(text).toContain("Driver handbook");
    expect(text).toContain("Road test examination");
  });

  it("previews the template whose row was pressed", async () => {
    const w = await render();
    const buttons = w.findAll("button").filter((b) => b.text() === "Preview and print");
    expect(buttons).toHaveLength(RECRUITMENT_TEMPLATES.length);
    const index = RECRUITMENT_TEMPLATES.findIndex((t) => t.key === "permission-mvr");
    await buttons[index]!.trigger("click");
    const preview = w.find("[data-test='preview']");
    expect(preview.attributes("data-open")).toBe("true");
    expect(preview.attributes("data-path")).toBe("/api/recruitment/templates/permission-mvr.pdf");
  });
});
