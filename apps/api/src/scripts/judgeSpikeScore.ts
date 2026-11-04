/**
 * OCR-JUDGE-PLAN.md J0 — score one or more `judgeSpike.ts` outputs. Pure: reads the JSON, prints a table.
 *
 * For every labelled field it asks each LANE one question with the live rule (`rowShows`, class tokens
 * unprovable): does the row's transcript print the TRUE value (a back), and does it print a one-digit MUTANT of it
 * (a false-back risk: a reader who misread that way would be backed)?
 *
 *   live     PaddleOCR's row as today (rowWitness.ts)
 *   item@t   per printed box, the transcript Jev scores highest, kept only at score ≥ t; the row is what is kept
 *   rescue@t live, and where live does not back the truth, item@t — what "use in checks" (J6) would add
 *
 * Also Jev's own discrimination on the boxes where the two engines DISAGREE about a labelled value: one
 * transcript prints the truth, the other a mutant (or nothing of it). That is the only decision Jev adds.
 *
 * Usage: pnpm --filter @silvicom/api exec tsx src/scripts/judgeSpikeScore.ts <run.json> [<run.json> …]
 */
import { readFileSync } from "node:fs";
import { rowShows, type Row } from "../modules/document-reading/evidence/rowWitness.js";
import { mutants } from "./judgeSpike.js";

interface Item { paddle: string; minicpm: string | null; scores: (number | null)[]; verdicts: string[]; ms: number }
interface RunRow {
  source: string; file: string; id: string; nth: number; row: null | object;
  paddle?: string; truth?: Record<string, number>; unprovable?: string[]; items?: Item[];
}

const asRow = (text: string): Row => ({ page: 1, bbox: { x: 0, y: 0, w: 1, h: 1 }, items: [{ text, box: { x: 0, y: 0, width: 1, height: 1 } }] });
const THRESHOLDS = [0.5, 0.8, 0.9, 0.95, 0.98, 0.99];

function itemText(items: readonly Item[], t: number): string {
  return items
    .map((it) => {
      const cands = [it.paddle, it.minicpm];
      let best = -1, bestS = -Infinity;
      it.scores.forEach((s, k) => { if (s !== null && s > bestS) { bestS = s; best = k; } });
      return best >= 0 && bestS >= t ? cands[best] ?? "" : "";
    })
    .join("\n");
}

function auroc(pos: number[], neg: number[]): number | null {
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

function main(): void {
  const rows: RunRow[] = process.argv.slice(2).flatMap((f) => (JSON.parse(readFileSync(f, "utf8")) as { rows: RunRow[] }).rows);
  for (const source of [...new Set(rows.map((r) => r.source)), "ALL"]) {
    const rs = rows.filter((r) => source === "ALL" || r.source === source);
    const judged = rs.filter((r) => r.row && r.truth && r.items);
    const fields = judged.flatMap((r) => Object.entries(r.truth!).map(([f, v]) => ({ r, f, v, unp: r.unprovable ?? [] })));
    const abstainLines = rs.filter((r) => !r.row).length;
    const ev = (text: (r: RunRow) => string) =>
      fields.reduce(
        (a, { r, v, unp }) => {
          const tx = text(r);
          const truth = rowShows(asRow(tx), v, unp);
          const bad = mutants(v).some((m) => rowShows(asRow(tx), m, unp));
          return { back: a.back + (truth ? 1 : 0), risk: a.risk + (bad ? 1 : 0), riskNoTruth: a.riskNoTruth + (bad && !truth ? 1 : 0) };
        },
        { back: 0, risk: 0, riskNoTruth: 0 },
      );
    console.log(`\n== ${source}: ${rs.length} lines (${abstainLines} without a row), ${fields.length} values judged`);
    console.log("lane            backs truth   prints a mutant   mutant without truth (a split reading would be backed WRONG)");
    const line = (name: string, e: { back: number; risk: number; riskNoTruth: number }) =>
      console.log(`${name.padEnd(15)} ${String(e.back).padStart(5)} / ${fields.length}   ${String(e.risk).padStart(8)}          ${String(e.riskNoTruth).padStart(8)}`);
    const live = ev((r) => r.paddle ?? "");
    line("live (Paddle)", live);
    line("MiniCPM boxes", ev((r) => r.items!.map((i) => i.minicpm ?? "").join("\n")));
    for (const t of THRESHOLDS) line(`item@${t}`, ev((r) => itemText(r.items!, t)));
    // rescue: live where live backs the truth, else item@t — per FIELD, so build it field by field.
    for (const t of THRESHOLDS) {
      let back = 0, risk = 0, riskNoTruth = 0;
      for (const { r, v, unp } of fields) {
        const liveTx = r.paddle ?? "";
        const tx = rowShows(asRow(liveTx), v, unp) ? liveTx : `${liveTx}\n${itemText(r.items!, t)}`;
        const truth = rowShows(asRow(tx), v, unp);
        const bad = mutants(v).some((m) => rowShows(asRow(tx), m, unp));
        back += truth ? 1 : 0; risk += bad ? 1 : 0; riskNoTruth += bad && !truth ? 1 : 0;
      }
      line(`rescue@${t}*`, { back, risk, riskNoTruth });
    }
    // Jev on the disagreements.
    const pos: number[] = [], neg: number[] = [];
    let disagreements = 0, jevRight = 0, unscored = 0, boxes = 0, ms = 0;
    for (const r of judged) {
      for (const it of r.items!) {
        boxes++; ms += it.ms;
        if (it.scores.some((s) => s === null)) unscored++;
        const cands = [it.paddle, it.minicpm];
        for (const [, v] of Object.entries(r.truth!)) {
          const shows = cands.map((c) => (c === null ? null : rowShows(asRow(c), v)));
          if (shows[0] === null || shows[1] === null || shows[0] === shows[1]) continue;
          // One engine prints the truth on this box, the other does not.
          disagreements++;
          const ti = shows[0] ? 0 : 1;
          const s = it.scores;
          if (s[ti] !== null) pos.push(s[ti]!);
          if (s[1 - ti] !== null) neg.push(s[1 - ti]!);
          if (s[0] !== null && s[1] !== null && s[ti]! > s[1 - ti]!) jevRight++;
        }
      }
    }
    console.log(`boxes ${boxes} (unscored ${unscored}), ${(ms / Math.max(1, boxes) / 1000).toFixed(1)} s a box for MiniCPM + Jev`);
    console.log(`boxes where the engines disagree on a true value: ${disagreements}; Jev picked the true one ${jevRight}; AUROC ${auroc(pos, neg)?.toFixed(3) ?? "n/a"}`);
  }
}

main();
