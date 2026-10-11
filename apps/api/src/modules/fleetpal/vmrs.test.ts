import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { FleetpalClient } from "./client.js";
import { clearComponentCache, describeComponents } from "./vmrs.js";

/**
 * F9c — component ids resolved to words, live, and forgotten (D-FP8).
 *
 * The fetch is a stub the client is built with, so every assertion about "asked again" or "did not
 * ask" is a count of real requests through the real client, not of calls to a mock of this module.
 */

const node = (id: string, code: string, description: string) => ({
  url: `https://openapi.fleetpal.io/v1/vmrs-components/${id}/`,
  id, code, description, level: 3, parent: code.slice(0, 7),
});

function vendor(answers: Record<string, { status: number; body?: unknown }>) {
  const asked: string[] = [];
  const fetchImpl = (async (url: string) => {
    const id = decodeURIComponent(String(url).split("/vmrs-components/")[1]!.replace(/\/$/, ""));
    asked.push(id);
    const a = answers[id] ?? { status: 404, body: { detail: "Not found." } };
    return new Response(JSON.stringify(a.body ?? {}), { status: a.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const client = new FleetpalClient({ apiKey: "k", baseUrl: "https://openapi.fleetpal.io", fetchImpl, maxRetries: 0 });
  return { client, asked };
}

beforeEach(() => clearComponentCache());

describe("describeComponents", () => {
  it("turns each distinct id into its code and words, asking once per id", async () => {
    const { client, asked } = vendor({
      hovDtcRc: { status: 200, body: node("hovDtcRc", "032-002-001", "ALTERNATOR") },
      SVQX9Nc4: { status: 200, body: node("SVQX9Nc4", "013-001-001", "BRAKE SHOE") },
    });
    const out = await describeComponents(client, "org-1", ["hovDtcRc", "SVQX9Nc4", "hovDtcRc"]);
    expect(out.get("hovDtcRc")).toEqual({ code: "032-002-001", description: "ALTERNATOR" });
    expect(out.get("SVQX9Nc4")).toEqual({ code: "013-001-001", description: "BRAKE SHOE" });
    expect(asked.sort()).toEqual(["SVQX9Nc4", "hovDtcRc"]);
  });

  it("answers null when FleetPal is down — never the opaque id, and never an error for the page", async () => {
    const { client } = vendor({ hovDtcRc: { status: 503 } });
    const out = await describeComponents(client, "org-1", ["hovDtcRc"]);
    expect(out.get("hovDtcRc")).toBeNull();
  });

  it("asks again after an outage, but not after a 404, within the hour", async () => {
    const down = vendor({ hovDtcRc: { status: 503 } });
    await describeComponents(down.client, "org-1", ["hovDtcRc", "gone1"]);
    const again = vendor({ hovDtcRc: { status: 200, body: node("hovDtcRc", "032-002-001", "ALTERNATOR") } });
    const out = await describeComponents(again.client, "org-1", ["hovDtcRc", "gone1"]);
    expect(again.asked).toEqual(["hovDtcRc"]);
    expect(out.get("hovDtcRc")?.description).toBe("ALTERNATOR");
    expect(out.get("gone1")).toBeNull();
  });

  it("forgets after an hour, and does not share one org's answer with another", async () => {
    let t = 1_000_000;
    const first = vendor({ hovDtcRc: { status: 200, body: node("hovDtcRc", "032-002-001", "ALTERNATOR") } });
    await describeComponents(first.client, "org-1", ["hovDtcRc"], () => t);

    const sameHour = vendor({});
    await describeComponents(sameHour.client, "org-1", ["hovDtcRc"], () => t + 59 * 60_000);
    expect(sameHour.asked).toEqual([]);

    const otherOrg = vendor({});
    await describeComponents(otherOrg.client, "org-2", ["hovDtcRc"], () => t);
    expect(otherOrg.asked).toEqual(["hovDtcRc"]);

    t += 61 * 60_000;
    const later = vendor({});
    await describeComponents(later.client, "org-1", ["hovDtcRc"], () => t);
    expect(later.asked).toEqual(["hovDtcRc"]);
  });

  it("holds no database client — the words have nowhere to be written", () => {
    const imports = readFileSync(new URL("./vmrs.ts", import.meta.url), "utf8")
      .split("\n")
      .filter((l) => l.startsWith("import "));
    expect(imports.length).toBeGreaterThan(0);
    for (const l of imports) expect(l).not.toMatch(/supabase|lib\/|store|syncState|credentials/i);
  });
});
