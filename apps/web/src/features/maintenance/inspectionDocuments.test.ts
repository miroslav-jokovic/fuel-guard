import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The inspection PDF verbs (2026-09-10).
 *
 * What these can get wrong that nothing else would catch: a download that opens a tab instead of
 * saving; a filename that does not name the unit and the date, or that lets a draft's preview pass
 * for the filed record; a draft asked for as a `report.pdf`, which the API answers 404.
 */

const fetchObjectUrl = vi.fn();
vi.mock("@/lib/api", () => ({ fetchObjectUrl: (...args: unknown[]) => fetchObjectUrl(...args) }));

const { downloadInspectionPdf, inspectionPdfFilename, inspectionPdfPath, openInspectionPdf } =
  await import("./inspectionDocuments");

beforeEach(() => {
  fetchObjectUrl.mockReset().mockResolvedValue("blob:report");
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(), revokeObjectURL: vi.fn() });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("which page", () => {
  it("asks for the filed report of a final inspection and the preview of a draft", () => {
    expect(inspectionPdfPath({ id: "i1", status: "final" })).toBe("/api/maintenance/inspections/i1/report.pdf");
    expect(inspectionPdfPath({ id: "i2", status: "draft" })).toBe("/api/maintenance/inspections/i2/preview.pdf");
  });

  it("names the file by unit and date, and marks a draft's preview as one", () => {
    expect(inspectionPdfFilename({ unit_number: "654", inspected_on: "2026-08-28", status: "final" })).toBe(
      "annual-inspection-654-2026-08-28.pdf",
    );
    expect(inspectionPdfFilename({ unit_number: "T 4102/A", inspected_on: "2026-09-08", status: "draft" })).toBe(
      "annual-inspection-T_4102_A-2026-09-08-preview.pdf",
    );
    expect(inspectionPdfFilename({ unit_number: null, inspected_on: "2026-09-08", status: "final" })).toBe(
      "annual-inspection-unit-2026-09-08.pdf",
    );
  });
});

describe("download", () => {
  it("hands the blob to the browser's save flow under the given name, and never opens a tab", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const clicked: HTMLAnchorElement[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
    await downloadInspectionPdf("/api/maintenance/inspections/i1/report.pdf", "annual-inspection-654-2026-08-28.pdf");
    expect(fetchObjectUrl).toHaveBeenCalledWith("/api/maintenance/inspections/i1/report.pdf");
    expect(clicked).toHaveLength(1);
    expect(clicked[0]!.download).toBe("annual-inspection-654-2026-08-28.pdf");
    expect(clicked[0]!.getAttribute("href")).toBe("blob:report");
    expect(open).not.toHaveBeenCalled();
    // The anchor does not linger in the document, and the URL is revoked once the save has started.
    expect(document.body.querySelector("a[download]")).toBeNull();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:report");
    click.mockRestore();
    open.mockRestore();
  });

  it("lets the API's own sentence through when the fetch fails", async () => {
    fetchObjectUrl.mockRejectedValueOnce(new Error("That report has not been filed."));
    await expect(downloadInspectionPdf("/api/x.pdf", "x.pdf")).rejects.toThrow("That report has not been filed.");
  });
});

describe("open", () => {
  it("opens the blob in a new tab and revokes it a minute later", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    await openInspectionPdf("/api/maintenance/inspections/i1/report.pdf");
    expect(open).toHaveBeenCalledWith("blob:report", "_blank", "noopener");
    vi.advanceTimersByTime(60_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:report");
    open.mockRestore();
  });
});
