import { describe, expect, it } from "vitest";
import { owedDerivatives } from "./backfillDocumentDerivatives.js";

describe("owedDerivatives", () => {
  it("owes a PDF its thumb alone, and an image both its thumb and its normalized copy", () => {
    expect(owedDerivatives([{ id: "p", content_type: "application/pdf" }, { id: "i", content_type: "image/jpeg" }], [])).toEqual([
      { id: "p", contentType: "application/pdf", missing: ["thumb"] },
      { id: "i", contentType: "image/jpeg", missing: ["thumb", "normalized"] },
    ]);
  });

  it("owes nothing to an original that already has what its type is owed — so a second run queues nothing", () => {
    expect(owedDerivatives(
      [{ id: "p", content_type: "application/pdf" }, { id: "i", content_type: "image/png" }],
      [{ derived_from: "p", variant: "thumb" }, { derived_from: "i", variant: "thumb" }, { derived_from: "i", variant: "normalized" }],
    )).toEqual([]);
  });

  it("owes only the missing half of a partly derived image", () => {
    expect(owedDerivatives([{ id: "i", content_type: "image/webp" }], [{ derived_from: "i", variant: "thumb" }]))
      .toEqual([{ id: "i", contentType: "image/webp", missing: ["normalized"] }]);
  });
});
