import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Fitness function for Step 5.4.
 *
 * A suite that starts an HTTP server and tears it down with a hand-rolled `server.close(…)` waits on
 * keep-alive sockets, hangs its `afterAll` for the full 10s hook timeout, and takes the worker down
 * with live sockets — turning `apps/api` red about one full run in four under CPU contention. The
 * fix is `closeTestServer`, and it only holds while EVERY suite uses it.
 *
 * So this asserts the property directly on the source: no test file may call `server.close(` itself.
 * Written as a source scan rather than a runtime check because the failure is a RACE — there is no
 * assertion that reliably observes it in one run, which is exactly how this defect survived two
 * sightings and eleven clean re-runs before it was captured.
 */
const API_SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function testFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "src/**/*.test.ts", "src/*.test.ts"], {
    cwd: path.dirname(API_SRC),
    encoding: "utf8",
  });
  return out.split("\n").filter(Boolean);
}

describe("test HTTP servers are torn down without waiting on keep-alive sockets", () => {
  const files = testFiles();

  it("finds the apps/api test files to scan", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("no suite calls server.close() directly — all of them go through closeTestServer", () => {
    const offenders = files.filter((file) => {
      // The helper's own module is not a test file, so nothing here is allowed to close a server.
      const src = readFileSync(path.join(path.dirname(API_SRC), file), "utf8");
      return /\.close\(/.test(src) && /\.listen\(/.test(src);
    });

    expect(offenders).toEqual([]);
  });

  it("every suite that starts a server imports the helper", () => {
    const missing = files.filter((file) => {
      const src = readFileSync(path.join(path.dirname(API_SRC), file), "utf8");
      if (!/\.listen\(0/.test(src)) return false;
      return !src.includes("closeTestServer");
    });

    expect(missing).toEqual([]);
  });
});
