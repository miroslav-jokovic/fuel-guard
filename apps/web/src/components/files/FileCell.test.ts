import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import FileCell from "@/components/files/FileCell.vue";

/**
 * The File cell's two UF5b additions: a drop on the cell is an event the page turns into "open the
 * unit's File section" (the bytes do not travel, so a drop with no files is nothing), and the hover
 * card says who filed a paper when the rollup knows.
 */
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

const paper = (documentId: string, uploadedBy: string | null) => ({
  documentId, kind: "registration", contentType: "application/pdf", thumbUrl: null, filedAt: "2026-03-01T00:00:00Z", uploadedBy,
});
const mountCell = () =>
  mount(FileCell, {
    props: {
      chip: { kind: "complete", n: 0, label: "Complete" },
      papers: [paper("p1", "Jane Office"), paper("p2", null)],
      paperCount: 2,
      items: [],
      subjectLabel: "Unit 654",
    },
  });

describe("FileCell", () => {
  it("emits the dropped files, and nothing for a drag that carried none", async () => {
    const w = mountCell();
    const cell = w.find("[data-test=file-cell]");
    const file = new File(["x"], "cab-card.pdf", { type: "application/pdf" });
    await cell.trigger("drop", { dataTransfer: { files: [file] } });
    expect(w.emitted("drop")).toEqual([[[file]]]);
    await cell.trigger("drop", { dataTransfer: { files: [] } });
    expect(w.emitted("drop")).toHaveLength(1);
  });

  it("says who filed a paper on its hover card, and only when the rollup knows", () => {
    const cards = mountCell().findAll("[role=tooltip]");
    expect(cards[0]!.text()).toContain("Filed 03/01/2026 by Jane Office");
    expect(cards[1]!.text()).toContain("Filed 03/01/2026");
    expect(cards[1]!.text()).not.toContain(" by ");
  });
});
