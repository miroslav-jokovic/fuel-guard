import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ADS_SETTINGS_UNSET, type AdsSettings } from "@silvicom/shared";
import type { ForcedTool, MessagesClient } from "../../../lib/anthropic.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { generateWithClaude, type ClaudeGenerationRequest } from "./claudeGeneration.js";
import type { GenerationRow } from "./generationLedger.js";

const ORG = "org-a";
const NOW = new Date("2026-11-15T18:00:00Z");
const tool: ForcedTool<{ headline: string }> = {
  name: "write_copy",
  description: "Fill the copy slots.",
  schema: z.object({ headline: z.string().min(1) }),
};
const req: ClaudeGenerationRequest<{ headline: string }> = {
  orgId: ORG,
  agent: "copywriter",
  creativeId: "cr-1",
  idempotencyKey: "copy:cr-1:1",
  promptVersion: "copywriter@1",
  model: "claude-sonnet-4-6",
  system: "You fill copy slots.",
  user: "brief",
  tool,
  maxTokens: 800,
};

const settings = (budget: number | null, enabled = true): AdsSettings => ({
  ...ADS_SETTINGS_UNSET,
  budgets: { ...ADS_SETTINGS_UNSET.budgets, anthropic_tokens_monthly: budget, agents_enabled: { copywriter: enabled } },
});

const isKeyRead = (q: RecordedQuery) => q.filters().some((f) => f.col === "idempotency_key");

/**
 * `ad_generations` answers by what was asked: a read by key → `prior`, the month fold → `monthRows`,
 * an insert → a new id (or `insertError`), an update → ok. `ads_settings_versions` → the saved version.
 */
function world(opts: { saved?: AdsSettings | null; prior?: GenerationRow | null; afterRace?: GenerationRow; monthRows?: unknown[]; insertError?: unknown } = {}) {
  let keyReads = 0;
  const rec = createSupabaseRecorder({
    tables: {
      ads_settings_versions: opts.saved === null ? [] : [{ id: "v1", settings: opts.saved ?? settings(100_000), kill_switch: false }],
      ad_generations: (q) => {
        if (q.write?.method === "insert") return opts.insertError ? { data: null, error: opts.insertError, writeError: opts.insertError } : [{ id: "gen-new" }];
        if (q.write) return [];
        if (isKeyRead(q)) {
          keyReads += 1;
          const row = keyReads === 1 ? opts.prior : opts.afterRace;
          return row ? [row] : [];
        }
        return opts.monthRows ?? [];
      },
    },
  });
  return rec;
}

function claude(input: unknown = { headline: "Home every weekend" }) {
  const create = vi.fn(async (_body: unknown) => ({
    id: "msg_9",
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "t1", name: "write_copy", input }],
    usage: { input_tokens: 1_000, output_tokens: 200 },
  }));
  return { client: { messages: { create } } as unknown as MessagesClient, create };
}

const run = (rec: ReturnType<typeof world>, client: MessagesClient) => generateWithClaude({ admin: rec.client, client, now: () => NOW }, req);
const inserts = (rec: ReturnType<typeof world>) => rec.writtenRows("ad_generations").filter((r) => "idempotency_key" in r);

describe("generateWithClaude — the budget (D-AD13)", () => {
  it("a spent budget writes budget_exhausted and asks no model", async () => {
    const rec = world({ saved: settings(5_000), monthRows: [{ id: "g1", cost_units: "3000.0000" }, { id: "g2", cost_units: 2_000 }] });
    const { client, create } = claude();
    const out = await run(rec, client);
    expect(out).toEqual({ kind: "budget_exhausted", generationId: "gen-new", refusal: "budget_spent", replayed: false });
    expect(create).not.toHaveBeenCalled();
    expect(inserts(rec)).toEqual([expect.objectContaining({ status: "budget_exhausted", error_code: "budget_spent", finished_at: NOW.toISOString() })]);
  });

  it("an unset budget refuses with a budget_exhausted row even with nothing used", async () => {
    const rec = world({ saved: settings(null) });
    const { client, create } = claude();
    expect(await run(rec, client)).toMatchObject({ kind: "budget_exhausted", refusal: "budget_unset" });
    expect(create).not.toHaveBeenCalled();
    expect(inserts(rec)[0]).toMatchObject({ status: "budget_exhausted", error_code: "budget_unset" });
  });

  it("a carrier that never saved settings asks no model", async () => {
    const rec = world({ saved: null });
    const { client, create } = claude();
    expect(await run(rec, client)).toEqual({ kind: "agent_off" });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("generateWithClaude — the per-agent switch (D-RA9)", () => {
  it("a switched-off agent asks no model and writes no row", async () => {
    const rec = world({ saved: settings(100_000, false) });
    const { client, create } = claude();
    expect(await run(rec, client)).toEqual({ kind: "agent_off" });
    expect(create).not.toHaveBeenCalled();
    expect(rec.writes()).toEqual([]);
  });
});

describe("generateWithClaude — replay (unique org + idempotency key)", () => {
  const row = (status: GenerationRow["status"], extra: Partial<GenerationRow> = {}): GenerationRow => ({
    id: "gen-old", status, output: null, error_code: null, started_at: "2026-11-15T17:00:00Z", ...extra,
  });

  it("a replayed key that succeeded returns the stored answer and asks no model", async () => {
    const rec = world({ prior: row("succeeded", { output: { headline: "Stored" } }) });
    const { client, create } = claude();
    expect(await run(rec, client)).toEqual({ kind: "succeeded", generationId: "gen-old", value: { headline: "Stored" }, replayed: true });
    expect(create).not.toHaveBeenCalled();
    expect(rec.writes()).toEqual([]);
  });

  it("a replayed key that failed or was refused asks no model", async () => {
    for (const prior of [row("failed", { error_code: "provider_529" }), row("budget_exhausted", { error_code: "budget_unset" })]) {
      const rec = world({ prior });
      const { client, create } = claude();
      expect(await run(rec, client)).toMatchObject({ generationId: "gen-old", replayed: true });
      expect(create).not.toHaveBeenCalled();
      expect(rec.writes()).toEqual([]);
    }
  });

  it("a started key is in flight: no second call", async () => {
    const rec = world({ prior: row("started") });
    const { client, create } = claude();
    expect(await run(rec, client)).toEqual({ kind: "in_flight", generationId: "gen-old", startedAt: "2026-11-15T17:00:00Z" });
    expect(create).not.toHaveBeenCalled();
  });

  it("a lost insert race reads the winner's row and asks no model", async () => {
    const rec = world({ insertError: { code: "23505", message: "duplicate key" }, afterRace: row("started") });
    const { client, create } = claude();
    expect(await run(rec, client)).toMatchObject({ kind: "in_flight", generationId: "gen-old" });
    expect(create).not.toHaveBeenCalled();
  });

  it("a stored answer that no longer parses is not handed on", async () => {
    const rec = world({ prior: row("succeeded", { output: { title: "old shape" } }) });
    const { client, create } = claude();
    expect(await run(rec, client)).toEqual({ kind: "failed", generationId: "gen-old", errorCode: "replay_off_schema", replayed: true });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("generateWithClaude — the call and its provenance", () => {
  it("the started row is written before the call and completed once with the tokens billed", async () => {
    const rec = world();
    const { client, create } = claude();
    create.mockImplementationOnce(async () => {
      expect(inserts(rec)).toEqual([expect.objectContaining({ status: "started", finished_at: null, agent: "copywriter", provider: "anthropic" })]);
      return { id: "msg_9", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "write_copy", input: { headline: "Home every weekend" } }], usage: { input_tokens: 1_000, output_tokens: 200 } };
    });
    expect(await run(rec, client)).toEqual({ kind: "succeeded", generationId: "gen-new", value: { headline: "Home every weekend" }, replayed: false });
    expect(create).toHaveBeenCalledTimes(1);
    const [started] = inserts(rec);
    expect(started).toMatchObject({ idempotency_key: "copy:cr-1:1", prompt_version: "copywriter@1", creative_id: "cr-1" });
    expect(started!.input_hash).toMatch(/^[0-9a-f]{64}$/);
    const updates = rec.forTable("ad_generations").filter((q) => q.write?.method === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.write!.payload).toMatchObject({ status: "succeeded", cost_units: 1_200, cost_unit: "tokens", provider_request_id: "msg_9" });
    expect(updates[0]!.filters()).toEqual(expect.arrayContaining([{ col: "id", val: "gen-new" }, { col: "status", val: "started" }]));
  });

  it("an off-schema answer is never returned as a value, and its tokens still count", async () => {
    const rec = world();
    const { client } = claude({ headline: "" });
    const out = await run(rec, client);
    expect(out).toEqual({ kind: "failed", generationId: "gen-new", errorCode: "off_schema", replayed: false });
    const update = rec.forTable("ad_generations").find((q) => q.write?.method === "update")!;
    expect(update.write!.payload).toMatchObject({ status: "failed", error_code: "off_schema", cost_units: 1_200 });
  });

  it("a provider error completes the row as failed", async () => {
    const rec = world();
    const { client, create } = claude();
    create.mockRejectedValueOnce(new Error("socket hang up"));
    expect(await run(rec, client)).toEqual({ kind: "failed", generationId: "gen-new", errorCode: "provider_error", replayed: false });
    const update = rec.forTable("ad_generations").find((q) => q.write?.method === "update")!;
    expect(update.write!.payload).toMatchObject({ status: "failed", error_code: "provider_error", cost_units: null, cost_unit: null });
  });

  it("every query and write names the org", async () => {
    const rec = world();
    await run(rec, claude().client);
    expectOrgScoped(rec, ORG);
  });
});
