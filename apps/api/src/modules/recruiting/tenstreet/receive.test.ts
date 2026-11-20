import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { loadEnv } from "../../../env.js";
import { open, secretAad } from "../../../lib/secretBox.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { hashTenstreetKey, receiveTenstreetPost, TENSTREET_SEAL_PURPOSE, tenstreetProcessDedupKey } from "./receive.js";
import { processTenstreetPost } from "./processPost.js";

/**
 * TS3 (TENSTREET-INTAKE-PLAN; Q-APX29/Q-APX30 (a)): the receiver's order — find the connection by the URL's
 * secret, read and clean the post, check the Company ID, refuse what can never succeed, keep the cleaned post
 * sealed, queue it, then answer — and the job that makes the lead. Tenstreet's sample 1 is the post, with an
 * SSA-invalid SSN planted (the committed samples are redacted).
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CONN = "1a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const KEY = "k".repeat(43);
const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64") } as NodeJS.ProcessEnv);
const noKeyEnv = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
const PLANTED = "000-12-3456";
const SAMPLE = readFileSync(new URL("../../../../../../docs/tenstreet/samples/receiving_application_data_sample_1_xml.txt", import.meta.url), "utf8")
  .replace(/(documentType="SSN">)xxx-xx-\d{4}/g, `$1${PLANTED}`);

function world(over: { conn?: Record<string, unknown> | null; insertError?: boolean } = {}) {
  const conn = over.conn === null ? [] : [{ id: CONN, org_id: ORG, company_id: "14", mode: "test", enabled: true, key_hash: hashTenstreetKey(KEY), ...over.conn }];
  const posts: Array<Record<string, unknown>> = [];
  const rec = createSupabaseRecorder({
    tables: {
      tenstreet_connections: (q: RecordedQuery) => (q.write ? { data: null } : postgrestFixture(conn)(q)),
      tenstreet_posts: (q: RecordedQuery) => {
        if (q.write?.method === "insert") {
          if (over.insertError) return { writeError: { message: "down" } };
          const row = { id: `post-${posts.length + 1}`, ...(q.write.payload as object) };
          posts.push(row);
          return [row];
        }
        return postgrestFixture(posts)(q);
      },
    },
  });
  return { rec, posts };
}
const receive = async (w: ReturnType<typeof world>, body: string | undefined, opts: { key?: string; env?: typeof env; enqueue?: () => Promise<"queued"> } = {}) => {
  const enqueue = vi.fn(opts.enqueue ?? (async () => "queued" as const));
  const a = await receiveTenstreetPost({ env: opts.env ?? env, admin: w.rec.client as never, enqueue, now: () => new Date("2026-11-20T15:00:00Z") }, opts.key ?? KEY, body);
  return { a, enqueue };
};

describe("receiveTenstreetPost — who may post", () => {
  it("an unknown key, a key of the wrong shape, or a connection switched off: 401 and nothing written", async () => {
    for (const [w, key] of [[world({ conn: null }), KEY], [world(), "short"], [world({ conn: { enabled: false } }), KEY]] as const) {
      const { a } = await receive(w, SAMPLE, { key });
      expect(a).toEqual({ status: 401, body: "" });
      expect(w.posts).toEqual([]);
    }
  });

  it("a post naming another carrier's Company ID: 401 and nothing written (a leaked URL alone is not enough)", async () => {
    const w = world({ conn: { company_id: "99" } });
    expect((await receive(w, SAMPLE)).a.status).toBe(401);
    expect(w.posts).toEqual([]);
  });

  it("no sealing key on the server: 503 to every post, nothing read", async () => {
    const w = world();
    expect((await receive(w, SAMPLE, { env: noKeyEnv })).a).toEqual({ status: 503, body: "" });
    expect(w.rec.queries).toEqual([]);
  });
});

describe("receiveTenstreetPost — what can never succeed is refused by name, logged without its body", () => {
  it.each([
    ["the other mode", SAMPLE.replace("<Mode>TEST</Mode>", "<Mode>PROD</Mode>"), "wrong_mode"],
    ["not XML", "<TenstreetData><Mode>", "not_xml"],
    ["a DOCTYPE", `<!DOCTYPE x><TenstreetData/>`, "doctype"],
    ["no DriverId", SAMPLE.replace("<DriverId>6346598</DriverId>", ""), "no_driver_id"],
    ["no body at all", undefined, "not_xml"],
  ] as const)("%s → REJECTED with a fixed sentence", async (_l, body, reason) => {
    const w = world();
    const { a, enqueue } = await receive(w, body);
    expect(a.status).toBe(200);
    expect(a.body).toContain("<Status>Rejected</Status>");
    expect(a.body).not.toContain("John");
    expect(w.posts).toEqual([expect.objectContaining({ org_id: ORG, connection_id: CONN, reply_status: "REJECTED", reply_reason: reason })]);
    expect(w.posts[0]!.body_sealed).toBeUndefined();
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("receiveTenstreetPost — a good post", () => {
  it("is kept sealed WITHOUT the SSN or the EEO answers, queued by its id, then answered Accepted", async () => {
    const w = world();
    const { a, enqueue } = await receive(w, SAMPLE);
    expect(a.status).toBe(200);
    expect(a.body).toContain("<DriverId>6346598</DriverId>");
    expect(a.body).toContain("<Status>Accepted</Status>");
    const row = w.posts[0]!;
    expect(row).toMatchObject({ reply_status: "ACCEPTED", reply_reason: "accepted", driver_ref: "6346598", mode: "TEST", removed: { government_id: 2, eeo: 1 } });
    const kept = open(env, String(row.body_sealed), secretAad(ORG, TENSTREET_SEAL_PURPOSE));
    expect(kept).toContain("<GivenName>John</GivenName>");
    expect(kept).not.toContain(PLANTED);
    expect(kept).not.toMatch(/GovernmentID|EqualEmploymentOpportunityData/);
    expect(JSON.stringify(w.rec.queries)).not.toContain(PLANTED);
    expect(enqueue).toHaveBeenCalledWith(ORG, "post-1");
    expect(tenstreetProcessDedupKey("post-1")).toBe("tenstreet_post_process:post-1");
    expect(a.queued).toBe("post-1");
    // The one lookup by the key is not an org's query — the key is what names the carrier; every other one is.
    const byKey = w.rec.queries.filter((q) => q.table === "tenstreet_connections" && !q.write);
    expect(byKey.map((q) => q.filters())).toEqual([[{ col: "key_hash", val: hashTenstreetKey(KEY) }]]);
    expectOrgScoped({ ...w.rec, queries: w.rec.queries.filter((q) => !byKey.includes(q)) }, ORG);
  });

  it("a store that fails, or a queue that fails, is 503 so Tenstreet repeats it", async () => {
    expect((await receive(world({ insertError: true }), SAMPLE)).a).toEqual({ status: 503, body: "" });
    expect((await receive(world(), SAMPLE, { enqueue: async () => { throw new Error("down"); } })).a).toEqual({ status: 503, body: "" });
  });
});

describe("processTenstreetPost — a kept post becomes a lead", () => {
  async function kept() {
    const w = world();
    await receive(w, SAMPLE);
    return w.posts[0]!;
  }
  function jobWorld(post: Record<string, unknown>) {
    const ingested: unknown[] = [];
    const rows: Array<Record<string, unknown>> = [{ processed_at: null, process_error: null, lead_id: null, ...post }];
    const rec = createSupabaseRecorder({
      tables: {
        tenstreet_posts: (q: RecordedQuery) => {
          if (q.write?.method === "update") {
            for (const r of postgrestFixture(rows)({ ...q, ops: q.ops.filter((o) => o.method !== "select") })) Object.assign(rows.find((x) => x.id === r.id)!, q.write.payload as object);
            return { data: null };
          }
          return postgrestFixture(rows)(q);
        },
        lead_match_verdicts: [], memberships: [], sms_suppressions: [], recruiting_openings: [],
      },
      rpc: (fn, args) => {
        if (fn === "ingest_lead") { ingested.push((args as { p_lead: unknown }).p_lead); return { lead_id: "50000000-0000-4000-8000-000000000001", stored: "new", matches: { leads: [], drivers: [] } }; }
        return null;
      },
    });
    return { rec, rows, ingested };
  }

  it("stores the lead once through recruiting's door, rings it, and marks the post processed with it", async () => {
    const j = jobWorld({ ...(await kept()), org_id: ORG });
    const r = await processTenstreetPost({ admin: j.rec.client as never, env, configured: async () => ["u-dana"] }, ORG, "post-1");
    expect(r).toEqual({ outcome: "processed", lead_id: "50000000-0000-4000-8000-000000000001", stored: "new" });
    expect(j.ingested).toEqual([expect.objectContaining({ channel: "tenstreet", external_ref: "6346598", full_name: "John Public" })]);
    expect(JSON.stringify(j.ingested)).not.toContain(PLANTED);
    expect(j.rows[0]).toMatchObject({ lead_id: "50000000-0000-4000-8000-000000000001" });
    expect(j.rows[0]!.processed_at).toBeTruthy();
    expect(j.rec.rpcs().some((c) => c.fn === "emit_notification")).toBe(true);
    expectOrgScoped(j.rec, ORG);
  });

  it("a processed post is done: the job does nothing again", async () => {
    const j = jobWorld({ ...(await kept()), org_id: ORG, processed_at: "2026-11-20T15:01:00Z" });
    expect(await processTenstreetPost({ admin: j.rec.client as never, env, configured: async () => [] }, ORG, "post-1")).toEqual({ outcome: "already" });
    expect(j.ingested).toEqual([]);
  });

  it("a post that is not this carrier's, or was refused, is not found", async () => {
    const j = jobWorld({ ...(await kept()), org_id: "0b000000-0000-4000-8000-000000000002" });
    expect((await processTenstreetPost({ admin: j.rec.client as never, env, configured: async () => [] }, ORG, "post-1")).outcome).toBe("not_found");
  });
});
