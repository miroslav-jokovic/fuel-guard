import { afterEach, describe, expect, it, vi } from "vitest";
import { AD_WORKER_OFFICE_LABEL, ADS_CAMPAIGN_WORKERS, ADS_WORKER_LEVELS, launchMissingLines, type AdsReadinessLevel } from "@silvicom/shared";
import { campaign, CONN, createAdsWorld, ORG, type AdsWorld } from "../../../testing/adsWorld.js";
import { expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { launchCampaign } from "./campaignDoors.js";
import { BAKED_READINESS, CAMPAIGN_CREATIVE_KIND, LAUNCH_LEVEL, type LaunchReadiness } from "./launchCertification.js";

/**
 * G-launch-gate (ADS-AGENT-BUILD-WORKFLOW §4R, "Production launch is refused in code unless the scorecard shows L4
 * for every worker the campaign uses"; 2026-11-05), through the real launch door over `adsWorld`.
 *
 * The workers a campaign uses are read from the baked table (`ADS_CAMPAIGN_WORKERS`), never listed here, so these
 * tests follow the table when it grows. Where a case needs a level the repo does not have yet (L4), the levels are
 * built from that same table and handed to the door; every other case runs on what is committed.
 */

const C = "70000000-0000-4000-8000-000000000001";
const ADMIN = { id: "u-admin", name: "Owner" };
const ASK = { daily_budget_cents: 5_000, lifetime_cap_cents: 50_000 };
const META_STILL = ADS_CAMPAIGN_WORKERS[`meta:${CAMPAIGN_CREATIVE_KIND}`]!;
const keyOf = (u: { worker: string; platform: string | null }) => (u.platform ? `${u.worker}|${u.platform}` : u.worker);

/** Every worker of the Meta still campaign at `level`, except `lower` at `lowerTo`. */
function levels(level: AdsReadinessLevel, lower?: string, lowerTo: AdsReadinessLevel = "L3"): LaunchReadiness {
  return { workers: ADS_CAMPAIGN_WORKERS, levels: Object.fromEntries(META_STILL.map((u) => [keyOf(u), keyOf(u) === lower ? lowerTo : level])) };
}

let w: AdsWorld;
const world = (connection: Record<string, unknown>) => {
  const approval = { id: "ap-1", org_id: ORG, campaign_id: C, kind: "launch", withdraws_id: null, approved_by: "u-admin", approved_by_name: "Owner", ...ASK, created_at: "2026-11-02T11:00:00Z" };
  w = createAdsWorld({ campaigns: [campaign(C, "paused", { daily_budget_cents: null, lifetime_cap_cents: null })], approvals: [approval], connections: [{ id: CONN, org_id: ORG, ...connection }] });
};
const launch = (readiness?: LaunchReadiness) => launchCampaign(w.admin, ORG, ADMIN, C, ASK, new Date("2026-11-05T15:00:00Z"), readiness);
const refusedRows = () => w.transitions(C).filter((a) => a.status === "refused");
const asked = (table: string) => w.rec.forTable(table).length;

afterEach(() => vi.unstubAllEnvs());

describe("G-launch-gate — a real platform launches only with every worker it uses at L4", () => {
  it("on what is committed today, a Meta campaign is refused: every worker it uses is named with its level, and the campaign says so", async () => {
    world({ provider: "meta", is_sandbox: false });
    const out = await launch();
    expect(out).toMatchObject({ kind: "launch_refused", refusal: "not_certified" });
    if (out.kind !== "launch_refused") throw new Error("not refused");
    // Every worker the table lists is below L4 today (nothing has a sandbox run), and each is named once.
    expect(out.missing.map(keyOf)).toEqual(META_STILL.map(keyOf));
    for (const m of out.missing) expect(m).toEqual({ worker: m.worker, platform: m.platform, level: ADS_WORKER_LEVELS[keyOf(m)] ?? "L0", needs: LAUNCH_LEVEL });
    // Office words (g-tidy): the Publisher's line names the platform, and no registry name or level reaches a person.
    expect(out.message).toContain(`${AD_WORKER_OFFICE_LABEL["Publisher (per adapter)"]}, on Meta (Facebook, Instagram)`);
    expect(out.message).not.toMatch(/\bL[0-5]\b|Publisher \(per adapter\)/);
    // Nothing moved; the reason is on the campaign for the review screen, and in one refused transition row.
    expect(w.byId(C)).toMatchObject({ state: "paused", daily_budget_cents: null, last_error: out.message });
    expect(refusedRows()).toEqual([expect.objectContaining({ error_code: "not_certified", actor_kind: "person", actor_id: "u-admin" })]);
    // Refused before any approval is read: an uncertified launch does not reach the money question.
    expect(asked("ads_approvals")).toBe(0);
    expectOrgScoped(w.rec, ORG);
  });

  it("with every worker it uses at L4, the same Meta campaign launches: paused → launching", async () => {
    world({ provider: "meta", is_sandbox: false });
    expect(await launch(levels("L4"))).toEqual({ kind: "moved", to: "launching" });
    expect(w.byId(C)).toMatchObject({ state: "launching", ...ASK, last_error: null });
  });

  it.each(META_STILL.map((u) => [keyOf(u)]))("%s alone at L3 is enough to refuse, and it is the one named", async (lowered) => {
    world({ provider: "meta", is_sandbox: false });
    const out = await launch(levels("L4", lowered));
    expect(out).toMatchObject({ kind: "launch_refused", refusal: "not_certified" });
    if (out.kind !== "launch_refused") throw new Error("not refused");
    expect(out.missing.map(keyOf)).toEqual([lowered]);
    expect(out.missing[0]).toMatchObject({ level: "L3", needs: "L4" });
    expect(w.byId(C).state).toBe("paused");
  });

  it("the Analyst is a worker a Meta campaign uses (L4-ruling): at L3, with every other worker at L4, Launch is refused naming it", async () => {
    // G-launch's done-when includes the next morning's brief, so the brief's writer must be certified too.
    world({ provider: "meta", is_sandbox: false });
    const out = await launch(levels("L4", "Analyst"));
    expect(out).toMatchObject({ kind: "launch_refused", refusal: "not_certified", missing: [{ worker: "Analyst", platform: null, level: "L3", needs: "L4" }] });
    if (out.kind !== "launch_refused") throw new Error("not refused");
    expect(out.missing).toHaveLength(1);
    expect(out.message).toContain(AD_WORKER_OFFICE_LABEL.Analyst);
    expect(w.byId(C)).toMatchObject({ state: "paused", last_error: out.message });
  });

  it("the campaign's last_error says exactly what the Launch form lists for the same refusal, in the same order", async () => {
    // On what is committed every part is missing, so the order is visible (a one-line refusal would hide it).
    world({ provider: "meta", is_sandbox: false });
    const out = await launch();
    if (out.kind !== "launch_refused") throw new Error("not refused");
    // What the screen renders for this refusal: `AdsCampaignLaunch.vue` lists `launchMissingLines(missing)`, one per line.
    const rendered = launchMissingLines(out.missing);
    const stored = String(w.byId(C).last_error);
    expect(stored).toBe(out.message);
    expect(rendered.length).toBeGreaterThan(1);
    expect(stored.slice(stored.indexOf(": ") + 2, -" Nothing was spent.".length - 1).split("; ")).toEqual(rendered);
  });

  it("a per-platform worker is read on its platform: the Publisher certified somewhere else is not certified on Meta", async () => {
    world({ provider: "meta", is_sandbox: false });
    const publisher = META_STILL.find((u) => u.platform)!;
    const readiness = levels("L4", keyOf(publisher));
    // Its name alone (its scorecard row, or another platform's run) reads L4 — the Meta key still says L3.
    const out = await launch({ ...readiness, levels: { ...readiness.levels, [publisher.worker]: "L4", [`${publisher.worker}|tiktok`]: "L4" } });
    expect(out).toMatchObject({ kind: "launch_refused", missing: [{ worker: publisher.worker, platform: publisher.platform, level: "L3" }] });
  });

  it("a Meta SANDBOX connection is a real connection: it reaches Meta, so it needs L4 too", async () => {
    world({ provider: "meta", is_sandbox: true });
    expect(await launch()).toMatchObject({ kind: "launch_refused", refusal: "not_certified" });
  });

  it("a provider the table does not list cannot launch at all, whatever the levels say", async () => {
    world({ provider: "tiktok", is_sandbox: false });
    expect(await launch(levels("L5"))).toMatchObject({ kind: "launch_refused", refusal: "platform_not_listed", missing: [] });
    expect(w.byId(C).state).toBe("paused");
  });
});

describe("G-launch-gate — the simulator is exempt only where its own gate allows it", () => {
  it("on staging, a simulator campaign launches with no worker certified", async () => {
    vi.stubEnv("DEPLOY_ENVIRONMENT", "staging");
    world({ provider: "simulator", is_sandbox: true });
    expect(await launch()).toEqual({ kind: "moved", to: "launching" });
  });

  it.each([
    ["production", { DEPLOY_ENVIRONMENT: "production" }],
    ["a built server with no deployment name", { NODE_ENV: "production", DEPLOY_ENVIRONMENT: "", RAILWAY_ENVIRONMENT_NAME: "" }],
  ])("on %s, a simulator campaign is refused at the door and stays paused", async (_name, envs) => {
    for (const [k, v] of Object.entries(envs)) vi.stubEnv(k, v);
    world({ provider: "simulator", is_sandbox: true });
    // Even with every worker certified: the simulator's refusal is the host's, not the scorecard's.
    const out = await launch(levels("L5"));
    expect(out).toMatchObject({ kind: "launch_refused", refusal: "simulator_not_allowed", missing: [] });
    expect(w.byId(C)).toMatchObject({ state: "paused", last_error: (out as { message: string }).message });
    expect(asked("ads_approvals")).toBe(0);
  });
});

describe("G-launch-gate — the door reads the baked levels", () => {
  it("by default the door's readiness is the generated module's, so the answer is the one committed at the deployed sha", () => {
    expect(BAKED_READINESS).toEqual({ workers: ADS_CAMPAIGN_WORKERS, levels: ADS_WORKER_LEVELS });
    // Every worker a campaign uses has a baked level: a missing key would read L0 silently.
    for (const rows of Object.values(ADS_CAMPAIGN_WORKERS)) for (const u of rows) expect(ADS_WORKER_LEVELS[keyOf(u)], keyOf(u)).toBeDefined();
  });
});
