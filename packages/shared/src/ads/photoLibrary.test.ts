import { describe, expect, it } from "vitest";
import { adBrandKitSchema, type AdAssetRef, type AdPhotoTag } from "./brandKitContract.js";
import { photoLibrary, photoLibraryAdvice, photoLibraryLine } from "./photoLibrary.js";

const asset = (c: string): AdAssetRef => ({ sha256: c.repeat(64), format: "png", source_format: "png", width: 800, height: 600, byte_size: 900 });
const photo = (c: string, tags: AdPhotoTag[]) => ({ label: `photo ${c}`, asset: asset(c), tags });
const kit = (photos: unknown[]) => adBrandKitSchema.parse({
  company_name: "Fixture Carrier", phone: null, colors: [{ name: "primary", hex: "#0B3D2E" }], logo: null,
  equipment_photos: photos, overlays: {}, people_policy: "none", forbidden_marks: [],
});

describe("a kit photo's tags (V3 photo library)", () => {
  it("a photo saved before tags parses with none, and the next save keeps what was ticked", () => {
    expect(kit([{ label: "tractor front", asset: asset("a") }]).equipment_photos[0]!.tags).toEqual([]);
    expect(kit([photo("a", ["truck", "yard"])]).equipment_photos[0]!.tags).toEqual(["truck", "yard"]);
  });

  it("refuses a tag outside the closed list and a tag named twice, each in a sentence", () => {
    const bad = (tags: unknown) => adBrandKitSchema.safeParse({ ...kit([]), equipment_photos: [{ label: "tractor front", asset: asset("a"), tags }] });
    expect(bad(["sunset"]).error!.issues[0]!.message).toBe("a photo's tag is one of: truck, trailer, driver, yard, road");
    expect(bad(["truck", "truck"]).error!.issues[0]!.message).toBe("a photo names each tag at most once");
  });
});

describe("what a kit's photo library holds", () => {
  it("counts photos per tag, a photo with two tags under both, and the photos that say nothing", () => {
    const lib = photoLibrary(kit([photo("a", ["truck", "trailer"]), photo("b", ["truck"]), photo("c", [])]));
    expect(lib).toEqual({ photos: 3, byTag: { truck: 2, trailer: 1, driver: 0, yard: 0, road: 0 }, untagged: 1 });
  });

  it("a kit with one photo is told every equipment ad will start from it (F-AG5)", () => {
    expect(photoLibraryAdvice(kit([photo("a", ["truck"])]))).toEqual([
      "One photo: every ad that shows equipment starts from it, so they will all show the same truck from the same side. Add two or three more, from other angles.",
    ]);
  });

  it("a kit with no photo is told an equipment ad cannot be made, and nothing about tags", () => {
    expect(photoLibraryAdvice(kit([]))).toEqual(["No photo yet: an ad that shows equipment cannot be made until the kit has one."]);
  });

  it("says how many photos do not say what they show, and nothing once every photo does", () => {
    expect(photoLibraryAdvice(kit([photo("a", ["truck"]), photo("b", []), photo("c", [])]))).toEqual(["2 photos do not say what they show yet."]);
    expect(photoLibraryAdvice(kit([photo("a", ["truck"]), photo("b", [])]))).toEqual(["1 photo does not say what it shows yet."]);
    expect(photoLibraryAdvice(kit([photo("a", []), photo("b", [])]))).toEqual(["No photo says what it shows yet. Tick what is in each one."]);
    expect(photoLibraryAdvice(kit([photo("a", [])]))).toHaveLength(2);
    expect(photoLibraryAdvice(kit([photo("a", ["truck"]), photo("b", ["road"])]))).toEqual([]);
  });

  it("the kit's one line names the count and each kind it holds, in the list's order", () => {
    expect(photoLibraryLine(kit([photo("a", ["yard", "truck"]), photo("b", ["truck"]), photo("c", [])]))).toBe("3 photos · 2 truck, 1 yard");
    expect(photoLibraryLine(kit([photo("a", [])]))).toBe("1 photo");
    expect(photoLibraryLine(kit([]))).toBe("0 photos");
  });
});
