import { describe, expect, it } from "vitest";
import { loadDataset, listDatasetVersions, LATEST_DATASET_VERSION } from "./index";

describe("@hazmat/data loader (H0)", () => {
  it("loads the latest dataset by default", () => {
    const ds = loadDataset();
    expect(ds.version).toBe(LATEST_DATASET_VERSION);
    expect(Array.isArray(ds.entries)).toBe(true);
  });

  it("lists at least the latest version", () => {
    expect(listDatasetVersions()).toContain(LATEST_DATASET_VERSION);
  });

  it("throws on an unknown version rather than returning a silent empty set", () => {
    expect(() => loadDataset("1999.01")).toThrow(/Unknown hazmat dataset/);
  });
});
