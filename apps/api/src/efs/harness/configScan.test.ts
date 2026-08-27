import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CARD_CAPABILITY_CONTRACTS } from "@silvicom/shared";
import { parseXml } from "../../lib/efsXml.js";
import { judgeField, observeField, scanConfig } from "./configScan.js";

/**
 * Step 4.4 — the instrument that answers "what does this account actually emit".
 *
 * Two live findings define what this has to get right. **H1 (2026-08-12):** we sent the guide's
 * `Hold` to an account that stores `HOLD`; EFS returned its usual void success and applied nothing.
 * **H3 (2026-08-15):** `overrideAllLocations` reads `false` on all 234 mirrored cards and `true` on
 * none, so the scope half of every override grant is unverifiable. The first must come out
 * `mismatch`, the second `unobserved`, and neither may come out `match`.
 */

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../lib/__fixtures__/efs/${name}`, import.meta.url)), "utf8");

const docs = (...xml: string[]) => xml.map((x) => parseXml(x)!);

/**
 * A minimal card, so a case can state exactly one thing.
 *
 * The `xsi` namespace is declared because the parser rejects an undeclared prefix outright — real
 * vendor responses carry it on the envelope, and a fixture that omitted it failed as "unparseable"
 * rather than as "nil", which is the distinction half these cases are about.
 */
const card = (body: string) =>
  `<card xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><header>${body}</header></card>`;

describe("observing a field as the vendor actually spells it", () => {
  it("keeps the exact text, without trimming or case-folding", () => {
    const o = observeField(docs(card("<status>HOLD</status>"), card("<status>Hold</status>")), "status");

    // Standing rule 4. A scanner that normalised here could never see the incident it exists to find.
    expect(o.rawSpellings.sort()).toEqual(["HOLD", "Hold"]);
    expect(o.occurrences).toBe(2);
  });

  it("separates nil, present-but-empty, and absent — the three the typed view collapses", () => {
    const o = observeField(
      docs(
        card('<status xsi:nil="true"/>'),
        card("<status></status>"),
        card("<policyNumber>1</policyNumber>"),
      ),
      "status",
    );

    expect(o.nilCount).toBe(1);
    expect(o.presentEmptyCount).toBe(1);
    // Documents, not occurrences: "this account never sends the field" is a different fact from
    // "this record left it blank", and only the first says the field is unreadable here.
    expect(o.absentCount).toBe(1);
    expect(o.observedValues).toEqual([]);
  });

  it("finds a field nested inside a repeated record, not just in the header", () => {
    const withPrompts = `<card><header><status>ACTIVE</status></header>`
      + `<infos><infoId>DRID</infoId><validationType>REPORT_ONLY</validationType></infos>`
      + `<infos><infoId>UNIT</infoId><validationType>EXACT_MATCH</validationType></infos></card>`;
    const o = observeField(docs(withPrompts), "validationType");

    // `collectElements` is direct-children only and `findDescendant` stops at the first hit; a prompt's
    // validationType lives two levels down and both would have missed one or all of them.
    expect(o.occurrences).toBe(2);
    expect(o.rawSpellings.sort()).toEqual(["EXACT_MATCH", "REPORT_ONLY"]);
  });

  it("counts an element carrying children rather than reading it as a value", () => {
    const o = observeField(docs(card("<status><nested>x</nested></status>")), "status");

    // Reading `textContent` here would report the value "x" for a shape that is not a scalar at all.
    expect(o.containerCount).toBe(1);
    expect(o.observedValues).toEqual([]);
  });
});

describe("the three states, and the one the step is named for", () => {
  it("reports UNOBSERVED, not match, for a value that never appears", () => {
    // The verify line of Step 4.4, and the reason the scanner is three-state at all: Step 4.6
    // refuses promotion on `unobserved` so that "no evidence" can never be spent as "evidence".
    const o = observeField(docs(card("<overrideAllLocations>false</overrideAllLocations>")), "overrideAllLocations");
    const v = judgeField("override_grant", "overrideAllLocations", ["true", "false"], o);

    expect(v.state).toBe("unobserved");
    expect(v.values).toEqual([
      { expected: "true", state: "unobserved" },
      { expected: "false", state: "observed_exact" },
    ]);
  });

  it("reports MISMATCH when the account spells our value differently — the H1 signature", () => {
    const o = observeField(docs(card("<status>HOLD</status>")), "status");
    const v = judgeField("card_lock", "status", ["Hold"], o);

    // This is the finding that says "your next write of this value will be silently ignored".
    expect(v.state).toBe("mismatch");
    expect(v.values[0]).toEqual({
      expected: "Hold", state: "observed_differently_cased", observedAs: ["HOLD"],
    });
  });

  it("reports MATCH only when every emittable value was seen exactly", () => {
    const o = observeField(
      docs(card("<overrideAllLocations>true</overrideAllLocations>"), card("<overrideAllLocations>false</overrideAllLocations>")),
      "overrideAllLocations",
    );
    expect(judgeField("override_grant", "overrideAllLocations", ["true", "false"], o).state).toBe("match");
  });

  it("does NOT call it a mismatch when the capability adapts the casing at write time", () => {
    const o = observeField(docs(card("<status>HOLD</status>")), "status");
    const v = judgeField("card_lock", "status", ["Hold"], o, true);

    // `matchStatusCasing` has spelled status writes from the account's own fresh read since the
    // 2026-08-12 incident, so `HOLD` vs `Hold` is a handled adaptation and NOT a write about to be
    // dropped. Reporting mismatch here would make a correct, safe capability permanently
    // unpromotable under Step 4.6's match-only gate — and would be a false claim about what happens
    // next. The per-value verdict still records the casing difference; nothing is hidden.
    expect(v.state).toBe("match");
    expect(v.values[0]).toEqual({
      expected: "Hold", state: "observed_differently_cased", observedAs: ["HOLD"],
    });
  });

  it("still reports unobserved on an adaptive field the account has never emitted", () => {
    const o = observeField(docs(card("<status>ACTIVE</status>")), "status");

    // Adapting the CASING of a value cannot conjure a value the account does not use. `Inactive` in
    // any spelling is absent here, and the adapter has nothing to adapt.
    expect(judgeField("card_lock", "status", ["Inactive"], o, true).state).toBe("unobserved");
  });

  it("lets mismatch outrank unobserved when both are present", () => {
    const o = observeField(docs(card("<status>HOLD</status>")), "status");
    const v = judgeField("card_lock", "status", ["Hold", "Inactive"], o);

    // `Inactive` is unobserved and `Hold` is mis-spelled. The mis-spelling is the actionable one —
    // reporting "unobserved" would describe the safer half of the problem.
    expect(v.state).toBe("mismatch");
  });
});

describe("scanning whole documents against the real capability registry", () => {
  it("counts an unparseable document instead of skipping it silently", () => {
    const report = scanConfig(["<card><header><status>ACTIVE</status></header></card>", "not xml at all"], CARD_CAPABILITY_CONTRACTS);

    // A scan that quietly read 40 of 234 cards would report `unobserved` for reasons that have
    // nothing to do with the account.
    expect(report.documentsScanned).toBe(1);
    expect(report.documentsUnparseable).toBe(1);
  });

  it("gives every capability's vocabulary field a verdict, sharing one observation per field", () => {
    const report = scanConfig([fixture("getCardV2.full.xml")], CARD_CAPABILITY_CONTRACTS);

    const declared = Object.values(CARD_CAPABILITY_CONTRACTS)
      .flatMap((c) => c.vocabularyFields.map((f) => `${c.key}.${f}`));
    expect(report.verdicts.map((v) => `${v.capability}.${v.field}`).sort()).toEqual(declared.sort());

    // `status` is claimed by card_lock AND card_unlock. Two observations would invite two answers.
    const statusObservations = report.fields.filter((f) => f.field === "status");
    expect(statusObservations).toHaveLength(1);
  });

  it("reproduces H3 from the checked-in fixtures: override scope is unobservable", () => {
    const report = scanConfig(
      ["getCardV2.full.xml", "getCardV2.overridden.xml", "getCardV2.nestedHeader.xml"].map(fixture),
      CARD_CAPABILITY_CONTRACTS,
    );

    // Every recorded response from this vendor carries `false`, including the one with an override
    // ARMED. The scanner must say so rather than call the field satisfied (docs/22 H3).
    const scope = report.verdicts.find((v) => v.field === "overrideAllLocations");
    expect(scope?.state).toBe("unobserved");
    expect(scope?.values.find((v) => v.expected === "true")?.state).toBe("unobserved");
    expect(scope?.observation.rawSpellings).toEqual(["false"]);
  });
});

/**
 * The read-only fields capabilities BRANCH on — the sweep that would have found this months earlier.
 *
 * `limitSource` gates Step 10.3's product override: POLICY means a card-level limit write cannot
 * govern that card's pump, so the grant is refused. Before this sweep the field had been observed on
 * exactly ONE card, by accident, in a drill run that refused and stopped (2026-08-18). The emit scan
 * could never have found it — it derives its fields from `emittableValues`, and nothing emits a
 * source field.
 */
describe("the fleet sweep of fields we only read", () => {
  it("counts limitSource across documents, including the POLICY value that started this", () => {
    // `empty.xml` really does carry limitSource POLICY; `full.xml` carries CARD. A fleet of both.
    const report = scanConfig(
      [fixture("getCardV2.full.xml"), fixture("getCardV2.empty.xml"), fixture("getCardV2.autoRoll.xml")],
      CARD_CAPABILITY_CONTRACTS,
    );
    const limitSource = report.dependedFields.find((f) => f.field === "limitSource");
    expect(limitSource).toBeDefined();

    const counts = Object.fromEntries(limitSource!.observedValues.map((v) => [v.text, v.count]));
    expect(counts.POLICY).toBe(1);
    expect(counts.CARD).toBeGreaterThanOrEqual(1);
  });

  it("sweeps all four source fields, not just the one that bit", () => {
    // `infoSource` reading BOTH is what Step 7.3 recorded and what made the source question look
    // settled. The same card reads limitSource POLICY. Sweeping one field would have kept that hidden.
    const report = scanConfig([fixture("getCardV2.empty.xml")], CARD_CAPABILITY_CONTRACTS);
    expect(report.dependedFields.map((f) => f.field).sort())
      .toEqual(["infoSource", "limitSource", "locationSource", "timeSource"]);

    const infoSource = report.dependedFields.find((f) => f.field === "infoSource");
    expect(infoSource!.observedValues.map((v) => v.text)).toContain("POLICY");
  });

  it("does not judge them — there is no emittable set to judge against", () => {
    // A verdict would be a claim that we send these, and we never do. The sweep OBSERVES.
    const report = scanConfig([fixture("getCardV2.empty.xml")], CARD_CAPABILITY_CONTRACTS);
    expect(report.verdicts.some((v) => v.field === "limitSource")).toBe(false);
  });
});
