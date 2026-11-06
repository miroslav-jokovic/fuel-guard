import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { certify, DRAFT, ROOT, runVitest, type CertifyIO } from "./adsCertify.js";
import { preflight, scrape, verdictOf, WORKER_RUNS, type Git } from "./adsCertifyPlan.js";

/**
 * `pnpm ads:certify` on fakes (stage2-kit): the refusals before anything runs, a planted reading difference
 * failing its worker by field, Security's scrape, and one real rehearsal of a worker's suite on FakeMeta
 * whose draft the readiness gate's own shape check takes but for its target.
 */

const SHA = "a".repeat(40);
const CLEAN: Git = { dirty: [], sha: SHA, onOriginMain: true };
const SANDBOX_ENV = {
  META_SANDBOX_TOKEN: "sandbox-user-token-123", META_SANDBOX_PAGE_TOKEN: "sandbox-page-token-456", META_SANDBOX_AD_ACCOUNT_ID: "act_42",
  META_SANDBOX_PAGE_ID: "7", META_SANDBOX_AD_ACCOUNT_IDS: "42",
};
const load = async <T>(rel: string) => (await import(pathToFileURL(join(ROOT, rel)).href)) as T;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function io(over: Partial<CertifyIO> = {}) {
  const root = mkdtempSync(join(tmpdir(), "ads-certify-"));
  dirs.push(root);
  const lines: string[] = [];
  const runSuite = vi.fn<CertifyIO["runSuite"]>(() => ({ exitCode: 0, passed: 3, failed: 0, notRun: 0, output: "ok" }));
  const checkSandboxAccount = vi.fn<CertifyIO["checkSandboxAccount"]>(async () => null);
  const value: CertifyIO = { root, env: {}, now: () => new Date("2026-11-09T15:00:00Z"), git: () => CLEAN, runSuite, checkSandboxAccount, print: (l) => lines.push(l), ...over };
  return { io: value, root, lines, out: () => lines.join("\n"), runSuite: (over.runSuite ?? runSuite) as typeof runSuite, checkSandboxAccount };
}

describe("ads:certify — what it runs (stage2-kit)", () => {
  it("has a run, built or not, for exactly the registry's workers", async () => {
    const { READINESS } = await load<{ READINESS: Array<{ worker: string }> }>("scripts/ads-readiness.registry.mjs");
    expect(Object.keys(WORKER_RUNS).sort()).toEqual(READINESS.map((r) => r.worker).sort());
  });
});

describe("ads:certify — refusals before anything runs", () => {
  it("a missing variable refuses the run, naming each one per worker, and runs nothing", async () => {
    const { META_SANDBOX_PAGE_ID: _, ...env } = SANDBOX_ENV;
    const h = io({ env });
    expect(await certify(["Publisher (per adapter)", "--target", "sandbox"], h.io)).toBe(2);
    expect(h.out()).toContain("Publisher (per adapter) needs META_SANDBOX_PAGE_ID");
    expect(h.runSuite).not.toHaveBeenCalled();
    expect(h.checkSandboxAccount).not.toHaveBeenCalled();
  });

  it("a dirty tree, or a HEAD that is not on origin/main, refuses a certification but not a rehearsal", () => {
    const dirty = preflight("sandbox", [], SANDBOX_ENV, { ...CLEAN, dirty: [" M apps/api/x.ts"] });
    expect(dirty).toEqual([expect.stringContaining("the tree is not clean (1 path(s):  M apps/api/x.ts)")]);
    expect(preflight("sandbox", [], SANDBOX_ENV, { ...CLEAN, onOriginMain: false })).toEqual([expect.stringContaining(`HEAD aaaaaaa is not on origin/main`)]);
    expect(preflight("fake", ["Publisher (per adapter)"], {}, { dirty: ["?? x"], sha: SHA, onOriginMain: false })).toEqual([]);
  });

  it("a sandbox account D-AD8 refuses stops the run with its reason; an unknown target or worker is refused", async () => {
    const h = io({ env: SANDBOX_ENV, checkSandboxAccount: async () => "Staging may only use a Meta sandbox ad account. This one has a payment method, so it could spend real money." });
    expect(await certify(["Outcome feed", "--target", "sandbox"], { ...h.io, env: { ...SANDBOX_ENV, META_SANDBOX_DATASET_ID: "1", META_SANDBOX_TEST_EVENT_CODE: "T", META_SANDBOX_LEAD_ID: "2" } })).toBe(2);
    expect(h.out()).toContain("D-AD8 refuses the sandbox account: Staging may only use a Meta sandbox ad account.");
    expect(h.runSuite).not.toHaveBeenCalled();
    const t = io();
    expect(await certify(["all", "--target", "prod"], t.io)).toBe(2);
    expect(await certify(["Nobody", "--target", "fake"], t.io)).toBe(2);
    expect(t.out()).toContain("got prod");
    expect(t.out()).toContain('name a worker or all: "Orchestrator"');
  });
});

describe("ads:certify — verdicts", () => {
  it("an unbuilt worker says exactly what is missing and certifies nothing", async () => {
    const h = io({ env: SANDBOX_ENV });
    expect(await certify(["Checker", "--target", "sandbox"], h.io)).toBe(1);
    expect(h.out()).toMatch(/NOT BUILT\s+Checker/);
    expect(h.out()).toContain("no threshold is set anywhere this command can read (Q-AD45)");
    expect(h.runSuite).not.toHaveBeenCalled();
    expect(() => readFileSync(join(h.root, DRAFT))).toThrow();
  });

  it("a planted difference in a re-recorded reading fails its worker, naming the field, and writes no draft", async () => {
    const planted = 'image-upload "hash is the md5 of the bytes": committed true, target answered false — correct platforms/simulator/fakeMetaAds.ts';
    const h = io({
      env: SANDBOX_ENV,
      runSuite: vi.fn((file, env, out) => {
        if (file.endsWith("readings.contract.test.ts")) writeFileSync(join(out, "readings-graph.json"), JSON.stringify({ differences: [planted] }));
        expect(env.ADS_TARGET).toBe("sandbox");
        return { exitCode: 0, passed: 2, failed: 0, notRun: 0, output: "" };
      }),
    });
    expect(await certify(["Publisher (per adapter)", "--target", "sandbox"], h.io)).toBe(1);
    expect(h.out()).toMatch(/FAIL\s+Publisher \(per adapter\)/);
    expect(h.out()).toContain(planted);
    expect(() => readFileSync(join(h.root, DRAFT))).toThrow();
  });

  it("Security's scrape names a leaked secret by its variable, never printing the value", async () => {
    expect(scrape("ok ... Bearer sandbox-user-token-123 ...", SANDBOX_ENV)).toEqual(["the value of META_SANDBOX_TOKEN appears in the run's output"]);
    const h = io({ env: SANDBOX_ENV, runSuite: vi.fn(() => ({ exitCode: 0, passed: 2, failed: 0, notRun: 0, output: "GET /me sandbox-page-token-456" })) });
    expect(await certify(["Security (all)", "--target", "sandbox"], h.io)).toBe(1);
    expect(h.out()).toContain("the value of META_SANDBOX_PAGE_TOKEN appears in the run's output");
    expect(h.out()).not.toContain("sandbox-page-token-456");
    expect(verdictOf("W", [{ exitCode: 0, passed: 0, failed: 0, notRun: 0 }], []).why).toEqual(["no test passed — a suite that ran nothing certifies nothing"]);
    expect(verdictOf("W", [{ exitCode: 0, passed: 4, failed: 0, notRun: 1 }], []).why).toEqual(["1 test(s) not run"]);
  });

  it("a PASS on the sandbox writes a draft the readiness gate accepts, for the run's sha, date and evidence", async () => {
    const h = io({ env: SANDBOX_ENV });
    expect(await certify(["Publisher (per adapter)", "--target", "sandbox"], h.io)).toBe(0);
    const draft = JSON.parse(readFileSync(join(h.root, DRAFT), "utf8")) as { certifications: Array<Record<string, string>> };
    expect(draft.certifications).toEqual([{ worker: "Publisher (per adapter)", platform: "meta", level: "L4", target: "sandbox", run_date: "2026-11-09", sha: SHA, result: "pass", evidence: expect.stringMatching(/^\.ads-certify\/.+-aaaaaaa\/summary\.json$/) }]);
    const gate = await load<{ certificationProblems: (c: unknown, r: unknown, t: unknown) => string[] }>("scripts/check-ads-readiness.mjs");
    const reg = await load<{ READINESS: unknown; CAMPAIGN_WORKERS: unknown }>("scripts/ads-readiness.registry.mjs");
    expect(gate.certificationProblems(draft.certifications, reg.READINESS, reg.CAMPAIGN_WORKERS)).toEqual([]);
    expect(JSON.parse(readFileSync(join(h.root, draft.certifications[0]!.evidence!), "utf8")).verdicts[0].verdict).toBe("PASS");
  });
});

describe("ads:certify — a rehearsal on FakeMeta, for real", () => {
  it("runs the Outcome feed's real suite with ADS_TARGET=fake and writes a draft the gate takes but for its target", async () => {
    const h = io({ runSuite: runVitest });
    expect(await certify(["Outcome feed", "--target", "fake"], h.io)).toBe(0);
    expect(h.out()).toMatch(/PASS\s+Outcome feed/);
    const draft = JSON.parse(readFileSync(join(h.root, DRAFT), "utf8")) as { certifications: Array<Record<string, string>> };
    const gate = await load<{ certificationProblems: (c: unknown, r: unknown, t: unknown) => string[] }>("scripts/check-ads-readiness.mjs");
    const reg = await load<{ READINESS: unknown; CAMPAIGN_WORKERS: unknown }>("scripts/ads-readiness.registry.mjs");
    expect(gate.certificationProblems(draft.certifications, reg.READINESS, reg.CAMPAIGN_WORKERS)).toEqual(['certification 1 (Outcome feed): an L4 run\'s target is "sandbox"']);
    expect(gate.certificationProblems(draft.certifications.map((c) => ({ ...c, target: "sandbox" })), reg.READINESS, reg.CAMPAIGN_WORKERS)).toEqual([]);
  }, 60_000);
});
