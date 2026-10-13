import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A number input that takes decimals must say `step="any"`. Without a `step`, an `<input type="number">` steps
 * by 1, and the browser marks any decimal invalid and refuses to submit the form — the Placard calculator
 * refused the owner's first hazmat BOL read on 2026-10-13 because its gross weight was 40,972.8 lb. A field
 * marked `inputmode="decimal"` is a field that expects decimals, so the two must come together.
 *
 * Read from the source, not a render: a field shown only for some answers (the cargo-tank capacity, only
 * for tank equipment) is never on screen in a test that did not choose them.
 */
// Resolved from cwd (vitest runs with `apps/web` as its root) — under jsdom `import.meta.url` is not a file URL.
const SRC = join(process.cwd(), "src");

function vueFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return vueFiles(path);
    return name.endsWith(".vue") ? [path] : [];
  });
}

describe("decimal number inputs", () => {
  it('give every type="number" inputmode="decimal" field step="any", so a decimal is not refused by the browser', () => {
    const missing = vueFiles(SRC).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return [...source.matchAll(/<(?:BaseInput|AppInput|input)\b[^>]*?>/gs)]
        .filter((m) => m[0].includes('type="number"') && m[0].includes('inputmode="decimal"') && !/\bstep=/.test(m[0]))
        .map((m) => `${relative(SRC, file)}:${source.slice(0, m.index).split("\n").length}`);
    });
    expect(missing).toEqual([]);
  });
});
