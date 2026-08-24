import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../testing/supabaseRecorder.js";
import { closeTestServer } from "../testing/httpServer.js";
import { hashIngestToken } from "../lib/ingestToken.js";

/**
 * WHO IS ALLOWED TO CLAIM THE ROSTER, over the wire.
 *
 * The Samsara syncs stand off when `org_integrations.config.roster_master` is set. Until this gate
 * existed the other half of that arrangement was decided by a QUERY PARAMETER the on-prem agent chose
 * for itself: an agent started with ROSTER_MODE=identity against an org that had never declared
 * mastery would write identity while the Samsara sync — still in full mode, because the flag it reads
 * is unset — nulled the same columns on its next tick. Both sides now read one flag.
 *
 * Exercised over HTTP rather than against the handler, because the mode is parsed from the request
 * and a unit test of the service could not reach the parameter that caused the problem.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TOKEN = "fgtms_" + "c".repeat(37);

let server: Server;
let baseUrl: string;

/** The agent's own request shape: bearer ingest token, one entity per call, mode in the query. */
const post = (path: string, body: unknown) =>
  fetch(`${baseUrl}/api/tms${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });

/** `master` decides only whether the org has DECLARED mastery — the token resolves either way. */
const seed = (master: boolean): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      org_integrations: [
        {
          org_id: ORG,
          provider: "mcleod",
          enabled: true,
          ingest_token_hash: hashIngestToken(TOKEN),
          config: master ? { roster_master: true } : {},
        },
      ],
      drivers: [],
      vehicles: [],
      trailers: [],
    },
  });

const DRIVERS = { drivers: [{ external_id: "D001", last_name: "Cora", first_name: "Angel" }] };

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => closeTestServer(server));

describe("the TMS may not claim the roster until the org declares it master", () => {
  it("refuses an identity sweep, naming the sequence that fixes it", async () => {
    holder.client = seed(false).client;
    const res = await post("/roster/drivers?mode=identity", DRIVERS);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("roster_master_not_declared");
    expect(body.error.message).toMatch(/link mode/);
  });

  it("refuses creation", async () => {
    holder.client = seed(false).client;
    expect((await post("/roster/vehicles?mode=create", { vehicles: [{ external_id: "104" }] })).status).toBe(409);
  });

  it("refuses retirement — the claim that starts the retention clock", async () => {
    holder.client = seed(false).client;
    const res = await post("/roster/drivers/retire", { retire: [{ external_id: "D001", status: "terminated" }] });
    expect(res.status).toBe(409);
  });

  it("writes NOTHING when it refuses", async () => {
    const rec = seed(false);
    holder.client = rec.client;
    await post("/roster/drivers?mode=identity", DRIVERS);
    expect(rec.writes()).toEqual([]);
  });

  it("allows LINK mode without the declaration — it is the measurement the decision is made from", async () => {
    holder.client = seed(false).client;
    const res = await post("/roster/drivers?mode=link", DRIVERS);
    expect(res.status).toBe(200);
    // Nothing matched an empty roster, so the whole payload comes back as the report M3 exists for.
    expect((await res.json()) as { unmatched: string[] }).toMatchObject({ unmatched: ["D001"] });
  });

  it("allows REPORT mode without the declaration, and it writes nothing", async () => {
    // The safest mode of all: it answers "what would this do" against the carrier's live fleet and
    // touches no row. Gating it would make the mastery decision impossible to inform.
    const rec = seed(false);
    holder.client = rec.client;
    const res = await post("/roster/drivers?mode=report", DRIVERS);
    expect(res.status).toBe(200);
    expect(rec.writes()).toEqual([]);
  });

  it("REFUSES a mode it does not recognise instead of quietly writing links", async () => {
    // The version-skew trap this replaced: `report` shipped in the agent before the API that
    // understands it, and the old fallthrough would have turned the one command that promises to
    // write nothing into a link sweep over ~589 production rows.
    const rec = seed(false);
    holder.client = rec.client;
    const res = await post("/roster/drivers?mode=repot", DRIVERS);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unknown_mode");
    expect(rec.writes()).toEqual([]);
  });

  it("treats a MISSING mode as report — a parameter nobody sent is a misconfiguration", async () => {
    const rec = seed(false);
    holder.client = rec.client;
    const res = await post("/roster/drivers", DRIVERS);
    expect(res.status).toBe(200);
    expect(rec.writes()).toEqual([]); // report: nothing, not even last_synced_at
  });

  it("allows an identity sweep once the org has declared mastery", async () => {
    holder.client = seed(true).client;
    expect((await post("/roster/drivers?mode=identity", DRIVERS)).status).toBe(200);
  });
});
