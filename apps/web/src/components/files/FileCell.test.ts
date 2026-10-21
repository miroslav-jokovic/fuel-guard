import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import FileCell from "@/components/files/FileCell.vue";

/**
 * The File cell's two UF5b additions: a drop on the cell is an event the page turns into "open the
 * unit's File section" (the bytes do not travel, so a drop with no files is nothing), and the hover
 * card says who filed a paper when the rollup knows. Since 2026-10-21 (Q-UF10, Q-UF11) the card dates
 * a paper by its own date, and the cell carries no state chip.
 */
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

// A paper dated 02/23/2026 whose row was written on 10/20 — the McLeod import's shape.
const paper = (documentId: string, uploadedBy: string | null) => ({
  documentId, kind: "registration", contentType: "application/pdf", thumbUrl: null,
  filedAt: "2026-10-20T20:00:00Z", datedAt: "2026-02-23T00:00:00Z", uploadedBy,
});
const mountCell = () =>
  mount(FileCell, {
    props: {
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

  it("dates a paper by its own date, and says who filed it only when a person did", () => {
    const cards = mountCell().findAll("[role=tooltip]");
    expect(cards[0]!.text()).toContain("Dated 02/23/2026");
    expect(cards[0]!.text()).toContain("Filed 10/20/2026 by Jane Office");
    // An import has no uploader: its row's date is the import run, so it is not shown at all.
    expect(cards[1]!.text()).toContain("Dated 02/23/2026");
    expect(cards[1]!.text()).not.toContain("Filed");
  });

  it("draws no state chip (Q-UF11) — the list's File filter is the place for the file's state", () => {
    const w = mountCell();
    expect(w.find("[data-test=file-chip]").exists()).toBe(false);
    expect(w.text()).not.toMatch(/missing|complete/i);
  });
});
