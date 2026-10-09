import { describe, it, expect } from "vitest";
import { parseSamsaraDocument } from "./documents.js";

/** A BOL-type submission in the shape Samsara served this carrier on 2026-10-08. */
const BOL = {
  id: "doc-1",
  createdAtTime: "2026-10-07T14:03:11Z",
  updatedAtTime: "2026-10-07T14:05:00Z",
  state: "submitted",
  documentType: { id: "type-bol", name: "BOL, SECURMENT, PLACARDS" },
  driver: { id: "drv-9", name: "Driver Nine" },
  vehicle: { id: "veh-7", name: "707", externalIds: { "samsara.vin": "X" } },
  route: { id: "r-1" },
  routeStop: { id: "rs-1", name: "Shipper DC" },
  fields: [
    {
      label: "Add Photos",
      type: "photo",
      value: { photoValue: [{ id: "p-1", url: "https://s3.samsara.com/a?sig=1" }, { id: "p-2", url: "https://s3.samsara.com/b" }] },
    },
  ],
};

const CALL = {
  id: "doc-2",
  createdAtTime: "2026-10-07T15:00:00Z",
  updatedAtTime: "2026-10-07T15:00:00Z",
  state: "submitted",
  documentType: { id: "type-loaded", name: "Loaded Call" },
  fields: [
    { label: " Load # ", type: "string", value: { stringValue: " 4410822 " } },
    { label: "Comments", type: "string", value: {} },
    { label: "Can I make it to the next stop Y/N?", type: "multipleChoice", value: {} },
  ],
};

describe("parseSamsaraDocument", () => {
  it("keeps photo ids and never a vendor url (D-DR9)", () => {
    const row = parseSamsaraDocument(BOL)!;
    expect(row.photo_ids).toEqual(["p-1", "p-2"]);
    expect(row.photo_count).toBe(2);
    expect(JSON.stringify(row)).not.toContain("s3.samsara.com");
    expect(row.fields[0]).toEqual({ label: "Add Photos", type: "photo", value: null, photoIds: ["p-1", "p-2"] });
  });

  it("carries driver, vehicle, stop and both vendor times", () => {
    expect(parseSamsaraDocument(BOL)).toMatchObject({
      samsara_document_id: "doc-1",
      document_type_id: "type-bol",
      document_type_name: "BOL, SECURMENT, PLACARDS",
      state: "submitted",
      samsara_driver_id: "drv-9",
      driver_name: "Driver Nine",
      samsara_vehicle_id: "veh-7",
      vehicle_name: "707",
      route_stop_id: "rs-1",
      route_stop_name: "Shipper DC",
      load_ref: null,
      samsara_created_at: "2026-10-07T14:03:11.000Z",
      samsara_updated_at: "2026-10-07T14:05:00.000Z",
    });
  });

  it("reads the Load # field by its exact label, trimmed", () => {
    expect(parseSamsaraDocument(CALL)!.load_ref).toBe("4410822");
  });

  it("does not read a near-miss label as the load number", () => {
    const row = parseSamsaraDocument({
      ...CALL,
      fields: [{ label: "Load number", type: "string", value: { stringValue: "4410822" } }],
    })!;
    expect(row.load_ref).toBeNull();
  });

  it("reads an unfilled field as null, not as an empty answer", () => {
    const row = parseSamsaraDocument(CALL)!;
    expect(row.fields.find((f) => f.label === "Comments")!.value).toBeNull();
    expect(row.fields.find((f) => f.type === "multipleChoice")!.value).toBeNull();
  });

  it("falls back to the created time when Samsara sends no updated time", () => {
    const { updatedAtTime: _, ...noUpdate } = BOL;
    expect(parseSamsaraDocument(noUpdate)!.samsara_updated_at).toBe("2026-10-07T14:03:11.000Z");
  });

  it.each([
    ["no id", { ...BOL, id: "" }],
    ["no type name", { ...BOL, documentType: { id: "t" } }],
    ["an unparseable created time", { ...BOL, createdAtTime: "yesterday-ish" }],
    ["not an object", "doc"],
  ])("refuses an item with %s rather than half-reading it", (_why, raw) => {
    expect(parseSamsaraDocument(raw)).toBeNull();
  });
});
