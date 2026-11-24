import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { consoleLogger, errorClass } from "./log.js";

const SRC = new URL(".", import.meta.url).pathname;

describe("logs carry counts and error classes only (§6 Logs)", () => {
  it("no file but log.ts calls console.* — every line goes through the typed logger", () => {
    const offenders = readdirSync(SRC)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "log.ts")
      .filter((f) => /\bconsole\s*\.\s*[a-z]+\s*\(/.test(readFileSync(join(SRC, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("an error is logged by class, never by message", () => {
    const e = new Error("ann@carrier.com said Load L-55501");
    expect(errorClass(e)).toBe("Unexpected");
    const named = Object.assign(new Error("secret text"), { name: "MailboxRefused" });
    expect(errorClass(named)).toBe("MailboxRefused");
  });

  it("an opened canary prints the bare alarm word the metric filter watches", () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (s: string) => { lines.push(s); };
    try { consoleLogger({ event: "canary", result: "opened" }); } finally { console.log = orig; }
    expect(lines[0]).toBe("CANARY_OPENED");
  });
});
