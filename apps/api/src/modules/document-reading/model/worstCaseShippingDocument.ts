import { shippingDocumentSchema, type ShippingDocument } from "@silvicom/shared";

/**
 * The largest REALISTIC shipping document the reader should ever have to write out — the fixture
 * `READ_MAX_TOKENS` is sized from (readPages.ts). Twelve hazmat lines is a full mixed-load BOL: the
 * corpus' busiest paper so far is a single page, and a two-page straight-bill with a continuation
 * sheet carries ten to twelve entries before a shipper switches to a separate dangerous-goods
 * manifest. Every field is filled with a value as long as the paper plausibly prints it — long
 * proper shipping names with an n.o.s. technical name, full street addresses, several references of
 * each kind — because an output budget sized from the AVERAGE document is the 2,048 cap F-DR7 found.
 *
 * It is parsed through the schema on construction, so a contract change that this fixture no longer
 * satisfies fails the sizing test rather than silently shrinking the measurement.
 */
const PSNS = [
  ["UN1203", "Gasoline", "3", "II", null],
  ["UN1993", "Flammable liquid, n.o.s.", "3", "III", "(Petroleum distillates, Xylene)"],
  ["UN1263", "Paint related material", "3", "II", null],
  ["UN2924", "Flammable liquid, corrosive, n.o.s.", "3 (8)", "II", "(Methanol, Sodium hydroxide)"],
  ["UN1789", "Hydrochloric acid", "8", "II", null],
  ["UN3082", "Environmentally hazardous substance, liquid, n.o.s.", "9", "III", "(Permethrin)"],
  ["UN1830", "Sulfuric acid with more than 51% acid", "8", "II", null],
  ["NA1993", "Combustible liquid, n.o.s.", "Combustible liquid", "III", "(Diesel fuel)"],
  ["UN2810", "Toxic liquid, organic, n.o.s.", "6.1", "III", "(Chlorpyrifos)"],
  ["UN1760", "Corrosive liquid, n.o.s.", "8", "II", "(Ethanolamine, Potassium hydroxide)"],
  ["UN3264", "Corrosive liquid, acidic, inorganic, n.o.s.", "8", "III", "(Phosphoric acid)"],
  ["UN1950", "Aerosols, flammable", "2.1", null, null],
] as const;

export function worstCaseShippingDocument(): ShippingDocument {
  const party = (name: string) => ({
    name,
    address: `${name.length * 97} Industrial Parkway Suite 400, Building C Dock 12, Elk Grove Village, IL 60007-1234`,
  });
  return shippingDocumentSchema.parse({
    identity: { bolNumber: "BOL-2026-0098765432-A", date: "10/08/2026 14:35 CDT", pageOf: { page: 2, of: 2 }, printedPageNumbers: ["Page 1 of 2 pages", "Page 2 of 2 pages"] },
    parties: {
      shipper: party("Midwest Specialty Chemical Distribution Company LLC"),
      consignee: party("Great Lakes Industrial Coatings and Finishing Incorporated"),
      billTo: party("Third Party Logistics Freight Audit and Payment Services Inc"),
    },
    references: {
      po: ["PO-4500987123", "PO-4500987124", "PO-4500987125"],
      customer: ["CUST-REF-00098712", "SO-778812-01"],
      consignee: ["RCV-2026-10-0088123", "DOCK-APPT-0812"],
    },
    freight: {
      pieces: 148, pallets: 26, weight: 43987.5, weightUnit: "lb",
      seals: ["SEAL-00987123", "SEAL-00987124"], trailer: "TRL 538812 / CHASSIS 77812",
    },
    hazmat: {
      lines: PSNS.map(([idText, psn, hazardClass, pg, technicalName], i) => ({
        idText, psn, hazardClass, pg, technicalName,
        descriptionText: [idText, `${psn}${technicalName ? ` ${technicalName}` : ""}`, hazardClass, pg && `PG ${pg}`].filter(Boolean).join(", "),
        quantity: { value: 1234.5 + i, unit: "gal" },
        grossWeightLb: 3456.75 + i, packageCount: 12 + i, perPackageWeightLb: 288.06,
        packaging: `${12 + i} steel drums 55 gal 1A1/Y1.4/150`,
        hmColumnMark: i % 3 === 0 ? "RQ" : "X",
        marks: ["MARINE POLLUTANT", "LIMITED QUANTITY", "HOT"],
      })),
      emergencyPhone: "CHEMTREC 1-800-424-9300 CCN 812345",
      shipperCertification: true,
      offeror: "Midwest Specialty Chemical Distribution Company LLC",
      emergencyContactText: "EMERGENCY CONTACT: CHEMTREC 24 HR — Contract CCN 812345 — Midwest Specialty Chemical",
    },
    otherLines: [
      "22 PLT Paper products, corrugated cartons (not regulated) 18,450 LBS CLASS 55",
      "4 PLT Plastic pails, empty, new (not regulated) 1,120 LBS CLASS 85",
      "1 CTN Material safety data sheets and shipping documents (not regulated) 12 LBS",
    ],
    execution: {
      receiverSignaturePresent: true,
      receiverName: "J. Rodriguez-Hernandez, Receiving Supervisor",
      deliveredAt: "10/09/2026 06:12 EDT",
      osdNotations: ["2 PCS SHORT ON LINE 4", "SHRINK WRAP TORN PALLET 7", "1 DRUM DENTED NO LEAK"],
    },
  });
}
