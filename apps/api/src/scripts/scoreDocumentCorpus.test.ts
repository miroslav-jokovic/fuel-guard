import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptyShippingDocument, leafFieldPaths, shippingDocumentLabelsSkeleton } from "@silvicom/shared";
import { formatScoreTables, loadCorpus, recordedRun, scoreSummary, scoreWith, type DocumentReader } from "./scoreDocumentCorpus.js";

// A SYNTHETIC corpus in a temp folder — never the real one (fixtures/real/private holds real BOLs).
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function synthetic() {
  const root = mkdtempSync(path.join(tmpdir(), "doc-score-"));
  dirs.push(root);
  const doc = emptyShippingDocument();
  doc.identity.bolNumber = "SYN-1";
  const labels = { ...shippingDocumentLabelsSkeleton(["pages/1.jpg"]), ...doc, labelledBy: ["a"] };
  labels.pages[0] = { ...labels.pages[0]!, class: "bol", band: "fair" };
  const write = (id: string, file: string, body: string) => {
    mkdirSync(path.dirname(path.join(root, id, file)), { recursive: true });
    writeFileSync(path.join(root, id, file), body);
  };
  const evidence = leafFieldPaths(doc).map((p) => ({ path: p, value: null, status: "read", sources: [], ruleVersion: "r1" }));
  const out = { document: doc, evidence, cost: { inputTokens: 1, outputTokens: 1, usd: 0.02 } };
  write("a", "labels.json", JSON.stringify(labels));
  write("a", "runs/base.json", JSON.stringify(out));
  write("b", "labels.json", JSON.stringify(shippingDocumentLabelsSkeleton(["pages/1.jpg"])));
  write("c", "labels.json", "{ not json");
  write("d", "labels.json", JSON.stringify(labels));
  write("d", "runs/base.json", "{ not json");
  return root;
}

describe("doc:score", () => {
  it("scores a recorded run, and reports unlabelled, unparseable and missing files by id", async () => {
    const root = synthetic();
    const s = await scoreWith(recordedRun("base"), loadCorpus(root));
    expect(s.documents).toEqual({
      total: 4, scored: 1, skippedUnlabelled: 1, invalidLabels: ["c"], missingOutputs: [], invalidOutputs: ["d"],
      readerFailures: [], operationalFailures: [],
    });
    expect(s.bands.map((b) => b.band)).toEqual(["fair", "all"]);
    expect(formatScoreTables(s)).toMatch(/identity\.bolNumber\s+standard\s+1\s+100\.0% \(1\/1\)\s+100\.0% \(1\/1\)\s+— \(0\/0\), 0 read/);
    expect(scoreSummary("base", root, s)).toMatchObject({ engineFalseAccepts: 0, overall: { costPerPage: 0.02 } });
  });

  it("scores a recorded reader failure, lists an operational one apart, and prints both with the two new columns", async () => {
    const root = synthetic();
    for (const [id, code] of [["e", "refusal"], ["f", "budget_exhausted"]] as const) {
      mkdirSync(path.join(root, id, "runs"), { recursive: true });
      writeFileSync(path.join(root, id, "labels.json"), readFileSync(path.join(root, "a", "labels.json")));
      writeFileSync(path.join(root, id, "runs", "base.json"), JSON.stringify({ failure: { code } }));
    }
    // "g" reads the paper right but invents a piece count the label leaves blank, as a `read` value.
    mkdirSync(path.join(root, "g", "runs"), { recursive: true });
    writeFileSync(path.join(root, "g", "labels.json"), readFileSync(path.join(root, "a", "labels.json")));
    const inventing = JSON.parse(readFileSync(path.join(root, "a", "runs", "base.json"), "utf8"));
    inventing.document.freight.pieces = 31;
    writeFileSync(path.join(root, "g", "runs", "base.json"), JSON.stringify(inventing));
    const s = await scoreWith(recordedRun("base"), loadCorpus(root));
    expect(s.documents).toMatchObject({ scored: 3, readerFailures: [{ id: "e", code: "refusal" }], operationalFailures: [{ id: "f", code: "budget_exhausted" }] });
    const text = formatScoreTables(s);
    expect(text).toMatch(/^field\s+crit\s+docs\s+accuracy\s+printed acc\s+invented\s+false-accept\s+yield/m);
    expect(text).toMatch(/identity\.bolNumber\s+standard\s+3\s+66\.7% \(2\/3\)\s+66\.7% \(2\/3\)\s+— \(0\/0\), 0 read\s+0\.0% \(0\/2\)\s+66\.7% \(2\/3\)/);
    expect(text).toMatch(/freight\.pieces\s+standard\s+3\s+33\.3% \(1\/3\)\s+— \(0\/0\)\s+33\.3% \(1\/3\), 1 read\s+50\.0% \(1\/2\)/);
    expect(text).toContain("failed reads scored as not read: 1: e (refusal)");
    expect(text).toContain("operational failures, not scored: 1: f (budget_exhausted)");
    expect(scoreSummary("base", root, s).overall).toMatchObject({ yield: 2 / 3, printedAccuracy: 2 / 3, invented: 1, inventedRead: 1 });
  });

  it("takes any injected reader, so a live reader plugs in where the recorded one does", async () => {
    const root = synthetic();
    const none: DocumentReader = { name: "none", read: async () => undefined };
    const s = await scoreWith(none, loadCorpus(root));
    expect(s.documents.missingOutputs).toEqual(["a", "d"]);
  });

  it("refuses a run name that is a path", () => {
    expect(() => recordedRun("../../etc")).toThrow(/plain name/);
  });
});
