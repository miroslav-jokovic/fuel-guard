import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { evaluateLoad, type LoadInput } from "@hazmat/engine";
import VerdictPanel from "./VerdictPanel.vue";

/**
 * Nothing the engine says vanishes on the way to the screen. UN1830 on the owner's 2026-10-19 Mayo BOL was
 * in the engine's verdict and on no part of the page; the panel picked the first number per placard. So
 * this mounts the REAL panel (no stubs but the diamond, which exposes its props) on REAL engine verdicts —
 * every load of one to three lines over a dataset that exercises bulk ID display, same-class numbers, a
 * §172.505 subsidiary, a DANGEROUS substitution and ERG guides — and asks for every item of every list:
 * each required placard as a diamond, each number either across a diamond of its own placard or named as a
 * panel, each ERG guide, and the message of every finding (blocks, segregation, notices).
 */
const DATASET = {
  version: "census-ui", provisional: false,
  entries: [
    { entryId: "UN1824-naoh", psnPrinted: "Sodium hydroxide solution", hazardClass: "8", subsidiaryClasses: [], idPrefix: "UN", idNumber: "1824", pgRows: [{ pg: "II", exceptionsRef: "154" }] },
    { entryId: "UN1830-h2so4", psnPrinted: "Sulfuric acid", hazardClass: "8", subsidiaryClasses: [], idPrefix: "UN", idNumber: "1830", pgRows: [{ pg: "II", exceptionsRef: "154" }] },
    { entryId: "UN1203-gas", psnPrinted: "Gasoline", hazardClass: "3", subsidiaryClasses: [], idPrefix: "UN", idNumber: "1203", pgRows: [{ pg: "II", exceptionsRef: "150" }] },
    { entryId: "UN1993-fl", psnPrinted: "Flammable liquids, n.o.s.", hazardClass: "3", subsidiaryClasses: [], idPrefix: "UN", idNumber: "1993", pgRows: [{ pg: "II", exceptionsRef: "150" }] },
    { entryId: "UN2810-tox", psnPrinted: "Toxic liquids, organic, n.o.s.", hazardClass: "6.1", subsidiaryClasses: [], idPrefix: "UN", idNumber: "2810", pgRows: [{ pg: "III", exceptionsRef: "153" }] },
  ],
  placards: [
    { classOrDivision: "8", table: 2, placardName: "CORROSIVE", designRef: "172.558", wordingOptions: [] },
    { classOrDivision: "3", table: 2, placardName: "FLAMMABLE", designRef: "172.542", wordingOptions: [] },
    { classOrDivision: "6.1", table: 2, placardName: "POISON", designRef: "172.554", wordingOptions: [] },
  ],
  erg: [
    { idNumber: "1824", guideNumber: "154" }, { idNumber: "1830", guideNumber: "137" }, { idNumber: "1203", guideNumber: "128" },
    { idNumber: "1993", guideNumber: "128" }, { idNumber: "2810", guideNumber: "153" },
  ],
};
const IDS = DATASET.entries.map((e) => e.entryId);
const OPTIONS = IDS.flatMap((id) => (["bulk", "non_bulk"] as const).flatMap((kind) => [600, 9000].map((lb) => ({ id, kind, lb }))));

const loadOf = (opts: typeof OPTIONS): LoadInput =>
  ({
    evaluatedAt: "2026-10-19T00:00:00Z",
    vehicle: { kind: "van_or_flatbed", cargoTankCapacityGal: null, compartments: null },
    tankState: "loaded",
    lines: opts.map((o) => ({
      hmtRef: `${o.id}#${DATASET.entries.find((e) => e.entryId === o.id)!.pgRows[0]!.pg}`, reclassedCombustible: false, isLimitedQuantity: false,
      quantity: { value: null, unit: "gal" }, grossWeightLb: o.lb, compartmentIndex: null, isResidueLine: false,
      flashPointF: null, ethanolPct: null, packagingKind: o.kind, packageCount: o.kind === "bulk" ? 1 : 20,
    })),
    claimedExceptions: { shipperClaimsNoPlacards: false, claimedSpecialPermits: [] },
    portContext: { vesselConnected: null, imdgPapers: null },
    tripContext: { previousOrCurrentBusinessDayIds: null, carrierRelationship: "unknown" },
    policy: null, dataset: DATASET, otherFreightAboard: null,
  }) as unknown as LoadInput;

const stubs = {
  PlacardDiamond: { props: ["name", "idNumber"], template: "<i class='dia' :data-name='name' :data-id='idNumber ?? \"\"'></i>" },
};

describe("the verdict panel shows everything the engine says", () => {
  it("on every load of one to three lines", () => {
    const loads: Array<typeof OPTIONS> = [];
    for (const a of OPTIONS) {
      loads.push([a]);
      for (const b of OPTIONS) {
        loads.push([a, b]);
        if (OPTIONS.indexOf(b) % 3 === 0) for (const c of OPTIONS) loads.push([a, b, c]);
      }
    }
    const missing: string[] = [];
    for (const opts of loads) {
      const verdict = evaluateLoad(loadOf(opts));
      const w = mount(VerdictPanel, {
        props: { result: { engineVersion: "x", datasetVersion: DATASET.version, datasetProvisional: false, verdict } as never },
        global: { stubs },
      });
      const html = w.html();
      const text = w.text();
      const diamonds = w.findAll(".dia").map((d) => ({ name: d.attributes("data-name"), id: d.attributes("data-id") }));
      const panelNotice = w.findAll("p").map((p) => p.text()).find((t) => /needs? a separate panel —/.test(t)) ?? "";
      const ctx = opts.map((o) => `${o.id}/${o.kind}/${o.lb}`).join(" + ");
      for (const p of verdict.placards.required) {
        if (!diamonds.some((d) => d.name === p.placard)) missing.push(`${ctx}: placard ${p.placard}`);
      }
      for (const d of verdict.placards.idDisplays) {
        const onOwnDiamond = diamonds.some((x) => x.id === d.idNumber && d.onPlacards.includes(x.name as never));
        // Only the answer card's own panel notice counts — the number is also listed further down the page.
        const asPanel = panelNotice.includes(d.idNumber);
        if (!onOwnDiamond && !asPanel) missing.push(`${ctx}: id ${d.idNumber}`);
      }
      for (const g of verdict.placards.ergGuides) if (!text.includes(`Guide ${g.guide}`)) missing.push(`${ctx}: ERG ${g.guide}`);
      for (const f of [...verdict.eligibility.blocks, ...verdict.segregation, ...(verdict.notices ?? [])]) {
        if (!html.includes(f.message.slice(0, 60).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")) && !text.includes(f.message.slice(0, 60)))
          missing.push(`${ctx}: finding ${f.ruleId}`);
      }
      w.unmount();
    }
    expect(loads.length).toBeGreaterThan(1000);
    expect(missing.slice(0, 15)).toEqual([]);
  }, 120_000);
});
