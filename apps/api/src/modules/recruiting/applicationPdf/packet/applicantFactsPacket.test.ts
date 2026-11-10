import { describe, expect, it } from "vitest";
import { APPLICANT_FACTS, type DriverApplication } from "@silvicom/shared";
import { packetFieldFill, packetFieldIdsUsed } from "./packetFieldValues.js";
import { PACKET_FIELD_LINES, PACKET_MARK_SIDE_LINES } from "./packetFieldGeometry.js";
import type { PacketFieldLine } from "./packetFieldGeometry.js";

/**
 * D-AM7's parity, from the packet's side (APPLICATION-FIX-PLAN F1). The contracts' side is
 * `packages/shared/src/applicantFacts.test.ts`.
 *
 * Two directions, both read from what the fill ACTUALLY places on a full application:
 *   1. every packet place the catalogue names is a line or a grid column the packet has;
 *   2. every value the fill places is claimed by a fact, or is one of the packet's own stamps (a
 *      signing date, the certification date) — so a value printed from a key nobody catalogued, or
 *      a catalogue entry pointing at the wrong column, fails here.
 * Whether every fact with a place is non-empty there is F2's test (the plan's §3 F2), not this one.
 */

/** A driver who answered everything, as a v2 owner-operator, so every conditional line is reached. */
const FULL = {
  first_name: "Marija",
  middle_name: "Ana",
  last_name: "Varmeda",
  date_of_birth: "1980-04-01",
  other_names: ["Marija Petrovic"],
  email: "m@example.test",
  phone: "(555) 011-1234",
  addresses: [
    { line1: "1301 Armitage Ave", line2: "Apt 2", city: "Melrose Park", state: "IL", postal_code: "60160", from: "2024-01", to: null },
    { line1: "9 Elm St", city: "Gary", state: "IN", postal_code: "46401", from: "2021-03", to: "2023-12" },
  ],
  cdl_number: "PA334554",
  cdl_state: "PA",
  cdl_class: "A",
  cdl_expires_at: "2029-01-01",
  additional_licences: [{ issuing_authority: "ON", number: "X1", expires_at: "2027-01-01", kind: "CLP" }],
  experience: "Ten years over the road.",
  equipment_experience: [
    { equipment_class: "tractor_semi_trailer", equipment_type: "Van", from: "2015-01", to: null, approx_miles: 900000 },
  ],
  accidents: [{ occurred_on: "2024-05-01", nature: "Backed into a post", fatalities: 0, injuries: 1, hazmat_spill: false }],
  declares_no_accidents: false,
  violations: [{ occurred_on: "2023-02-01", offence: "Speeding", state: "IL", penalty: "Fine" }],
  declares_no_violations: false,
  licence_ever_denied: true,
  licence_denial_detail: "Suspended for unpaid ticket in 2019.",
  prior_failed_pre_employment_test: false,
  employers: [
    {
      key: "11111111-1111-4111-8111-111111111111",
      employer_name: "Acme Freight",
      usdot_number: "1234567",
      address_line1: "1 Dock Rd",
      city: "Joliet",
      state: "IL",
      phone: "(555) 011-9999",
      email: "hr@acme.test",
      position_held: "Driver",
      started_on: "2020-01-01",
      ended_on: null,
      operated_cmv: true,
      dot_regulated: true,
      reason_for_leaving: null,
      subject_to_fmcsr: true,
      safety_sensitive: true,
    },
  ],
  declares_no_employment: false,
  employment_gaps: [],
  questionnaire_answers: {
    position: "Driver",
    applying_as: "owner_operator",
    heard_from: "Indeed",
    legally_work: true,
    proof_of_age: true,
    may_contact_employers: true,
    education: [{ school: "Lincoln High", years_completed: "4", field_of_study: "General", graduated: true, graduated_when: "1998" }],
    military_service: true,
    military_when: "2000–2004",
    other_training: "Hazmat course",
    references: [{ full_name: "Ivan Ivic", years_known: "10", phone: "(555) 011-2222" }],
  },
  certified: true,
  signed_name: "Marija Varmeda",
} as unknown as DriverApplication;

const MARKED = Object.fromEntries(
  [...new Set(PACKET_MARK_SIDE_LINES.map((l) => l.placementId)), "p15", "p22", "p27", "p28"].map((id) => [id, "2026-09-14T09:00:00Z"]),
);

const { placed } = packetFieldFill({
  application: FULL,
  certifiedAt: "2026-09-14T09:00:00Z",
  markedAt: MARKED,
  signedName: "Marija Varmeda",
});

/**
 * The packet's own stamps: the day the application was certified, and the date beside or under each
 * signature. Server facts (D-APP9), never the applicant's — so they are not catalogued, and are the
 * only placed values allowed to go unclaimed.
 */
const STAMP_LINES = new Set([
  "p01.date",
  "p15.date",
  "p22.date",
  "p27.date",
  "p28.date",
  ...PACKET_MARK_SIDE_LINES.filter((l) => l.kind === "date").map((l) => l.id),
]);

const CLAIMED = new Set(APPLICANT_FACTS.flatMap((f) => (Array.isArray(f.packet) ? f.packet : [])));

/**
 * A grid claimed column by column is held to its columns: a bare `p02.experience` (the class picks
 * the row) must not also excuse a column nobody claimed. A bare grid id claims the whole grid only
 * where no fact claims a column of it — a table answer such as `p16.education`.
 */
const BY_COLUMN = new Set([...CLAIMED].filter((c) => c.includes("#")).map((c) => c.split("#")[0]!));

const claims = (line: PacketFieldLine): string[] => [
  line.id,
  ...(line.cell ? [`${line.cell.tableId}#${line.cell.col}`] : []),
  ...(line.cell && !BY_COLUMN.has(line.cell.tableId) ? [line.cell.tableId] : []),
];

describe("the packet against the applicant fact catalogue (D-AM1)", () => {
  it("places enough of a full application for the checks below to mean something", () => {
    expect(placed.length).toBeGreaterThan(60);
  });

  it("claims every value the packet places, except its own stamps", () => {
    const unclaimed = placed
      .filter((p) => !STAMP_LINES.has(p.line.id))
      .filter((p) => !claims(p.line).some((c) => CLAIMED.has(c)))
      .map((p) => p.line.id);
    expect([...new Set(unclaimed)]).toEqual([]);
  });

  it("names only places the packet has", () => {
    const real = new Set<string>(packetFieldIdsUsed());
    for (const line of [...PACKET_FIELD_LINES, ...placed.map((p) => p.line)]) {
      real.add(line.id);
      if (line.cell) real.add(line.cell.tableId).add(`${line.cell.tableId}#${line.cell.col}`);
    }
    expect([...CLAIMED].filter((c) => !real.has(c))).toEqual([]);
  });
});
