import { describe, expect, it } from "vitest";
import { readStickerCode, type AssetTypeDto } from "@silvicom/shared";
import { fillFromSticker, type StickerForm } from "./stickerFill";

const IMEI = "490154203237518";
const type = (id: string, name: string, heldBy: "unit" | "driver", serialized = true): AssetTypeDto => ({
  id, name, category: null, serialized, defaultKitQuantity: 0, imagePath: null, heldBy,
});
const TABLET = type("t-tab", "Tablet", "driver");
const EXTINGUISHER = type("t-ext", "Fire extinguisher", "unit");
const empty = (): StickerForm => ({ assetTypeId: "", name: "", serialNumber: "", imei: "", model: "", manufacturer: "" });

/** Scan a whole sticker, in order, the way the form does: each read applied to the form so far. */
function scan(codes: string[], types = [TABLET, EXTINGUISHER], start = empty()) {
  let form = start;
  let autoName = "";
  const notes: string[] = [];
  for (const c of codes) {
    const { patch, note } = fillFromSticker(form, readStickerCode(c), types, autoName);
    if (patch.name !== undefined) autoName = patch.name;
    form = { ...form, ...patch };
    if (note) notes.push(note);
  }
  return { form, notes };
}

describe("filling the form from a tablet's sticker", () => {
  it("fills IMEI, serial, model and maker from the three barcodes, in any order, and picks the tablet type", () => {
    const a = scan([IMEI, "R52W40ABCDE", "SM-T575"]);
    const b = scan(["SM-T575", "R52W40ABCDE", IMEI]);
    for (const { form, notes } of [a, b]) {
      expect(form).toEqual({ assetTypeId: "t-tab", name: "Samsung SM-T575", serialNumber: "R52W40ABCDE", imei: IMEI, model: "SM-T575", manufacturer: "Samsung" });
      expect(notes).toEqual([]);
    }
  });

  it("names it after the type until the model arrives, and lets the model rename it", () => {
    expect(scan([IMEI]).form.name).toBe("Tablet");
    expect(scan([IMEI, "SM-T575"]).form.name).toBe("Samsung SM-T575");
  });

  it("never renames a tablet the person already named", () => {
    expect(scan([IMEI, "SM-T575"], undefined, { ...empty(), name: "Dana's tablet" }).form.name).toBe("Dana's tablet");
  });

  it("keeps the first IMEI of a dual-SIM tablet and says the second was set aside", () => {
    const { form, notes } = scan([IMEI, "356938035643809"]);
    expect(form.imei).toBe(IMEI);
    expect(notes[0]).toMatch(/second IMEI \(356938035643809\)/);
  });

  it("keeps the serial when a second serial-shaped code arrives", () => {
    const { form, notes } = scan(["R52W40ABCDE", "X1Y2Z3W4"]);
    expect(form.serialNumber).toBe("R52W40ABCDE");
    expect(notes[0]).toMatch(/Another code \(X1Y2Z3W4\)/);
  });

  it("chooses no type when none, or more than one, is held by a driver — the person picks", () => {
    expect(scan([IMEI], [EXTINGUISHER]).form.assetTypeId).toBe("");
    expect(scan([IMEI], [TABLET, type("t-tab2", "Phone", "driver")]).form.assetTypeId).toBe("");
  });

  it("touches nothing for a misread IMEI, the SIM's number or the box barcode", () => {
    expect(scan(["490154203237519", "8901260882212345678", "036000291452"]).form).toEqual(empty());
  });
});
