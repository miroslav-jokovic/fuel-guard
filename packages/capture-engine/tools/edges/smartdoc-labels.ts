import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { LABELS_VERSION, parseLabels, type DocumentKind, type LabelEntry } from "../../src/edges/labels";

/**
 * SmartDoc 2015 challenge 1 → our label format (LIVE-EDGE-DETECTION-PLAN.md §4.4, the public check).
 *
 *   pnpm --filter @silvicom/capture-engine edges:smartdoc -- <frames dir> [--every 20]
 *
 * Writes `<frames dir>/labels.json`. The frames come from the dataset's own release
 * (github.com/jchazalon/smartdoc15-ch1-dataset, v2.0.0 `frames.tar.gz`, sha256 3acb8be1…9eae, CC BY 4.0 —
 * cite Burie et al., ICDAR 2015). They are a 972 MB download and are NOT committed or fetched by CI.
 *
 * Every 20th frame by default: 1,245 of 24,889, the sample docap published its 0.990 on, so the two
 * numbers are comparable. Consecutive frames of one clip are near-duplicates; scoring all of them would
 * take twenty times as long to say the same thing.
 *
 * The dataset lists corners top-left, BOTTOM-left, bottom-right, top-right; ours go top-left, top-RIGHT,
 * bottom-right, bottom-left. The reorder is the one line in this file that can silently ruin a benchmark,
 * which is why the labels are run through `parseLabels` before they are written: a wrong order crosses
 * the outline, and the parser refuses a crossed outline.
 */

const KIND: Record<string, DocumentKind> = { letter: "letter", tax: "form" };

function main(): void {
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const dir = argv[0] ? resolve(argv[0]) : undefined;
  if (!dir) {
    console.error("✗ usage: edges:smartdoc <frames dir> [--every N]");
    process.exit(2);
  }
  const everyAt = argv.indexOf("--every");
  const every = everyAt >= 0 ? Number(argv[everyAt + 1]) : 20;

  const rows = gunzipSync(readFileSync(join(dir, "metadata.csv.gz"))).toString("utf8").trim().split("\n");
  const header = rows.shift()!.split(",");
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`metadata.csv has no column ${name}`);
    return i;
  };
  const c = {
    bg: col("bg_name"), type: col("modeltype_name"), path: col("image_path"), frame: col("frame_index"),
    tlx: col("tl_x"), tly: col("tl_y"), blx: col("bl_x"), bly: col("bl_y"),
    brx: col("br_x"), bry: col("br_y"), trx: col("tr_x"), try: col("tr_y"),
  };

  const entries: LabelEntry[] = [];
  for (const line of rows) {
    const f = line.split(",");
    if ((Number(f[c.frame]) - 1) % every !== 0) continue;
    const n = (i: number) => Number(f[i]);
    const file = f[c.path]!;
    entries.push({
      id: createHash("sha256").update(readFileSync(join(dir, file))).digest("hex"),
      file,
      width: 1920,
      height: 1080,
      document: {
        corners: [
          { x: n(c.tlx), y: n(c.tly) },
          { x: n(c.trx), y: n(c.try) },
          { x: n(c.brx), y: n(c.bry) },
          { x: n(c.blx), y: n(c.bly) },
        ],
        kind: KIND[f[c.type]!] ?? "other",
      },
      tags: { set: "smartdoc15", background: f[c.bg]!, doctype: f[c.type]! },
    });
  }
  const labels = parseLabels({ version: LABELS_VERSION, entries });
  writeFileSync(join(dir, "labels.json"), JSON.stringify(labels, null, 1) + "\n");
  console.log(`✓ ${labels.entries.length} SmartDoc 2015 frames labelled → ${join(dir, "labels.json")}`);
}

main();
