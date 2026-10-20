import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SCHEDULERS, schedulersInLane } from "./schedulers.js";
import { SCHEDULER_LANES, parseSchedulerLanes } from "./schedulerLanes.js";
import { toLaneHealth, HANDOVER_GRACE_S } from "./lib/schedulerHealth.js";

/**
 * The scheduler registry and its lanes (D-RLY2). The property that matters is a PARTITION: every
 * scheduler is in exactly one lane, so running each lane in exactly one process runs each scheduler
 * exactly once — and none is in no lane, which would be a scheduler that silently never runs.
 */
describe("the scheduler lanes partition every scheduler", () => {
  it("registers every start function schedulers.ts imports — none imported and left unrun", () => {
    const source = readFileSync(fileURLToPath(new URL("./schedulers.ts", import.meta.url)), "utf8");
    const imported = [...source.matchAll(/import \{([^}]+)\} from "\.\/(?:modules|orchestration|queue)\//g)]
      .flatMap((m) => m[1]!.split(","))
      .map((s) => s.trim())
      .filter((s) => /^start[A-Z]/.test(s));
    expect(imported.length).toBeGreaterThan(20);
    const registered = SCHEDULERS.map((s) => s.start.toString());
    for (const name of imported) {
      expect(SCHEDULERS.some((s) => s.start.name === name) || registered.some((body) => new RegExp(`\\b${name}\\b`).test(body)), name).toBe(true);
    }
  });

  it("gives every scheduler one name and one known lane, and leaves no lane empty", () => {
    const names = SCHEDULERS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const s of SCHEDULERS) expect(SCHEDULER_LANES).toContain(s.lane);
    for (const lane of SCHEDULER_LANES) expect(schedulersInLane(lane).length).toBeGreaterThan(0);
    expect(SCHEDULER_LANES.flatMap((l) => schedulersInLane(l)).length).toBe(SCHEDULERS.length);
  });

  it("keeps everything that dials EFS in the egress lane, and nothing else there", () => {
    // Card management is IP-gated by WEX (docs/22 status 2026-08-11); the feeds share the account's
    // per-process login breaker. All of it stays on the whitelisted service; nothing else needs to.
    expect(schedulersInLane("egress").map((s) => s.name).sort()).toEqual(
      ["efs-card-sync", "efs-soap-cert-expiry", "efs-soap-poller", "job-drain:egress"].sort(),
    );
  });
});

describe("SCHEDULER_LANES", () => {
  it("defaults to every lane — the single-service deploy runs exactly what it ran before", () => {
    expect(parseSchedulerLanes(undefined)).toEqual([...SCHEDULER_LANES]);
    expect(parseSchedulerLanes("")).toEqual([...SCHEDULER_LANES]);
    expect(parseSchedulerLanes(" ALL ")).toEqual([...SCHEDULER_LANES]);
  });

  it("reads a comma list, once per lane", () => {
    expect(parseSchedulerLanes("egress")).toEqual(["egress"]);
    expect(parseSchedulerLanes("general, egress,general")).toEqual(["general", "egress"]);
  });

  it("refuses a lane it does not know — a typo must fail the boot, not run nothing in silence", () => {
    expect(() => parseSchedulerLanes("egres")).toThrow(/unknown lane\(s\) egres/);
    expect(() => parseSchedulerLanes(",")).toThrow(/no lane named/);
  });
});

describe("a lane's health, from its lease row (D-RLY3)", () => {
  const NOW = Date.parse("2026-10-20T12:00:00Z");
  const iso = (offsetS: number) => new Date(NOW + offsetS * 1000).toISOString();

  it("is held while the lease is live, handover just after it expires, stale once nobody has taken it for two minutes", () => {
    const health = toLaneHealth(
      [
        { lane: "egress", renewed_at: iso(-10), expires_at: iso(50) },
        { lane: "general", renewed_at: iso(-80), expires_at: iso(-20) },
      ],
      NOW,
    );
    expect(health).toEqual([
      { lane: "egress", state: "held", secondsSinceRenewal: 10 },
      { lane: "general", state: "handover", secondsSinceRenewal: 80 },
    ]);
    const later = toLaneHealth([{ lane: "general", renewed_at: iso(-200), expires_at: iso(-HANDOVER_GRACE_S - 1) }], NOW);
    expect(later.find((l) => l.lane === "general")!.state).toBe("stale");
  });

  it("names a lane no process has ever held as missing, and a failed read as unknown", () => {
    expect(toLaneHealth([], NOW).map((l) => l.state)).toEqual(["missing", "missing"]);
    expect(toLaneHealth(null, NOW).map((l) => l.state)).toEqual(["unknown", "unknown"]);
  });
});
