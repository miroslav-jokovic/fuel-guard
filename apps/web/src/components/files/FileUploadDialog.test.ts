import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { DQ_ITEMS, EQUIPMENT_ITEMS } from "@silvicom/shared";
import FileUploadDialog from "@/components/files/FileUploadDialog.vue";

/**
 * The list's upload dialog (DQ-FILE-COLUMN) is the file page's drop-first flow (D-DQ10) in a panel:
 * the drop card first, then the requirement drawer with the scan attached, one panel at a time. The
 * two children have their own suites; this pins the hand-off between them and the D-ROS1 condition —
 * the file's outstanding items are in view beside the drop zone.
 */
const SlideOverStub = { props: ["open", "title", "size"], template: "<div v-if='open' data-test='drop-panel'><slot /></div>" };
const DropCardStub = { name: "DocumentDropCard", props: ["subject", "items", "initialFile"], template: "<div />" };
const DrawerStub = { name: "RequirementDrawer", props: ["open", "subject", "specs", "itemKey", "presetDocument"], template: "<div />" };

const mountDialog = (props: Record<string, unknown> = {}) =>
  mount(FileUploadDialog, {
    props: {
      subject: { type: "driver", id: "d1" },
      subjectLabel: "Pat Papers",
      items: [{ key: "medical_card", label: "Medical card", evidenceKind: "medical_card" }],
      outstanding: [{ key: "medical_card", label: "Medical card", state: "expired" }],
      fileLink: "/compliance/d1",
      ...props,
    },
    global: {
      stubs: {
        SlideOver: SlideOverStub,
        DocumentDropCard: DropCardStub,
        RequirementDrawer: DrawerStub,
        RouterLink: { props: ["to"], template: "<a :href='to'><slot /></a>" },
      },
    },
  });

describe("FileUploadDialog", () => {
  it("carries a scan dropped on the list's cell into the drop card", () => {
    const scan = new File(["x"], "med.pdf");
    const w = mountDialog({ initialFile: scan });
    expect(w.findComponent(DropCardStub).props("initialFile")).toBe(scan);
    expect(w.findComponent(DrawerStub).props("open")).toBe(false);
  });

  it("lists what the file still needs, and links to the full file", () => {
    const w = mountDialog();
    expect(w.find('[data-test="upload-outstanding"]').text()).toContain("Medical card");
    expect(w.find("a").attributes("href")).toBe("/compliance/d1");
  });

  it("hands a filed scan to the requirement drawer, closing the drop panel", async () => {
    const w = mountDialog();
    w.findComponent(DropCardStub).vm.$emit("filed", { documentId: "doc1", name: "med.pdf", key: "medical_card" });
    await w.vm.$nextTick();
    const drawer = w.findComponent(DrawerStub);
    expect(drawer.props("open")).toBe(true);
    expect(drawer.props("itemKey")).toBe("medical_card");
    expect(drawer.props("presetDocument")).toEqual({ id: "doc1", name: "med.pdf" });
    expect(drawer.props("specs")).toBe(DQ_ITEMS);
    expect(w.find('[data-test="drop-panel"]').exists()).toBe(false);
  });

  it("records an outstanding item with no scan, and closing the drawer closes the dialog", async () => {
    const w = mountDialog();
    await w.find('[data-test="upload-outstanding"] button').trigger("click");
    const drawer = w.findComponent(DrawerStub);
    expect(drawer.props("itemKey")).toBe("medical_card");
    expect(drawer.props("presetDocument")).toBeNull();
    drawer.vm.$emit("close");
    expect(w.emitted("close")).toHaveLength(1);
  });

  it("looks a unit's keys up in the equipment catalogue", () => {
    const w = mountDialog({ subject: { type: "tractor", id: "v1" }, subjectLabel: "Unit 654" });
    expect(w.findComponent(DrawerStub).props("specs")).toBe(EQUIPMENT_ITEMS);
  });
});
