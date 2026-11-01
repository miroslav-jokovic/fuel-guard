import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { hashInvitationToken } from "../applicationIntake.js";

/**
 * The orientation videos (HW8a, 0538), through the mount: the carrier's list in Settings → Recruiting,
 * one applicant's videos and "Send the videos", and the applicant's page on their link. 0538's tables
 * have no client policies and the API reads with the service role, so `expectOrgScoped` is the only
 * layer that can see a missing org filter.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_ORG = "11111111-2222-4333-8444-555555555555";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const OTHER_DRIVER = "77777777-8888-4999-8aaa-000000000000";
const INV = "44444444-5555-4666-8777-888888888888";
const V1 = "90000000-0000-4000-8000-000000000001";
const V2 = "90000000-0000-4000-8000-000000000002";
const V_THEIRS = "90000000-0000-4000-8000-00000000000f";
const TOKEN = "t".repeat(43);

const ctx = (role: string): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = Object.fromEntries(
  ["admin", "recruiter", "auditor", "dispatcher", "driver"].map((r) => [r, ctx(r)]),
);

let server: Server;
let baseUrl: string;
let rec: SupabaseRecorder;

const call = (path: string, token: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/recruitment${path}`, {
    ...init,
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
  });
const pub = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/public/application/${path}`, {
    ...init,
    headers: { "content-type": "application/json", "user-agent": "phone" },
  });

const VIDEOS = [
  { id: V1, org_id: ORG, title: "Pre-trip", url: "https://v.example/1", minutes: 10, required: true, position: 0, created_at: "2026-10-01T00:00:00Z", retired_at: null },
  { id: V2, org_id: ORG, title: "Using the ELD", url: "https://v.example/2", minutes: null, required: false, position: 1, created_at: "2026-10-01T00:00:01Z", retired_at: null },
  { id: V_THEIRS, org_id: OTHER_ORG, title: "Theirs", url: "https://v.example/x", minutes: 1, required: true, position: 0, created_at: "2026-10-01T00:00:00Z", retired_at: null },
];

function seed(over: { videos?: unknown[]; invitations?: unknown[] } = {}): SupabaseRecorder {
  rec = createSupabaseRecorder({
    tables: {
      drivers: postgrestFixture([
        { id: DRIVER, org_id: ORG, status: "applicant", email: "ana@x.test" },
        { id: OTHER_DRIVER, org_id: OTHER_ORG, status: "applicant", email: null },
      ]),
      organizations: postgrestFixture([{ id: ORG, name: "Silvicom Inc" }]),
      recruiting_settings: [],
      orientation_videos: postgrestFixture((over.videos as Record<string, unknown>[] | undefined) ?? VIDEOS),
      application_invitations: postgrestFixture((over.invitations as Record<string, unknown>[] | undefined) ?? [{
        id: INV, org_id: ORG, driver_id: DRIVER, email: "ana@x.test", token_hash: hashInvitationToken(TOKEN),
        expires_at: "2099-01-01T00:00:00Z", revoked_at: null, handbook_filed_at: null, consented_at: null,
        orientation_videos_sent_at: "2026-10-20T10:00:00Z", created_at: "2026-10-01T00:00:00Z",
      }]),
      orientation_video_attestations: postgrestFixture([
        { org_id: ORG, driver_id: DRIVER, video_ids: [V1], signer_name: "Ana Plicant", attested_at: "2026-10-21T10:00:00Z" },
        { org_id: OTHER_ORG, driver_id: OTHER_DRIVER, video_ids: [V_THEIRS], signer_name: "Them", attested_at: "2026-10-22T10:00:00Z" },
      ]),
      orientation_video_opens: postgrestFixture([
        { org_id: ORG, driver_id: DRIVER, video_id: V2, opened_at: "2026-10-20T11:00:00Z" },
        { org_id: ORG, driver_id: DRIVER, video_id: V2, opened_at: "2026-10-20T12:00:00Z" },
      ]),
      sms_consents: [],
      sms_outbox: [],
      audit_logs: [],
    },
  });
  holder.client = rec.client;
  return rec;
}

/** The public routes resolve the token by its hash, across the org boundary by design — the token IS the access. */
const TOKEN_LOOKUP = { exempt: ["application_invitations"] };

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    const found = CTX[t];
    if (!found) throw new Error("bad token");
    return found;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));

describe("the carrier's list (Settings → Recruiting)", () => {
  it("lists this carrier's live videos to anybody who can view recruiting, and nobody else", async () => {
    seed();
    const res = await call("/orientation-videos", "auditor");
    expect(res.status).toBe(200);
    const { videos } = (await res.json()) as { videos: Array<{ id: string }> };
    expect(videos.map((v) => v.id)).toEqual([V1, V2]);
    expectOrgScoped(rec, ORG);
    for (const token of ["dispatcher", "driver"]) {
      seed();
      expect((await call("/orientation-videos", token)).status).toBe(403);
      expect(rec.queries).toHaveLength(0);
    }
  });

  it("adds a video org-scoped, required by default, after the last one, and audits it", async () => {
    seed();
    const res = await call("/orientation-videos", "recruiter", {
      method: "POST", body: JSON.stringify({ title: "  Coupling  ", url: "https://v.example/3" }),
    });
    expect(res.status).toBe(201);
    expect(rec.writtenRows("orientation_videos")).toEqual([{
      org_id: ORG, title: "Coupling", url: "https://v.example/3", minutes: null, required: true, position: 2, created_by: "u-recruiter",
    }]);
    expect(rec.writtenRows("audit_logs")[0]!.action).toBe("recruitment.orientation_video_added");
    expectOrgScoped(rec, ORG);
  });

  it("refuses an http link and a viewer's write before any query", async () => {
    seed();
    const http = await call("/orientation-videos", "recruiter", { method: "POST", body: JSON.stringify({ title: "x", url: "http://v.example/3" }) });
    expect(http.status).toBe(400);
    const viewer = await call("/orientation-videos", "auditor", { method: "POST", body: JSON.stringify({ title: "x", url: "https://v.example/3" }) });
    expect(viewer.status).toBe(403);
    expect(rec.writtenRows("orientation_videos")).toEqual([]);
  });

  it("retires a video (never deletes it), org-scoped, and says not found for another carrier's", async () => {
    seed();
    const res = await call(`/orientation-videos/${V1}`, "recruiter", { method: "PATCH", body: JSON.stringify({ retire: true }) });
    expect(res.status).toBe(200);
    const [row] = rec.writtenRows("orientation_videos");
    expect(row).toMatchObject({ retired_by: "u-recruiter" });
    expect(typeof row!.retired_at).toBe("string");
    expect(rec.writes().map((w) => w.write!.method)).not.toContain("delete");
    expect(rec.writtenRows("audit_logs")[0]!.action).toBe("recruitment.orientation_video_retired");
    expectOrgScoped(rec, ORG);

    seed();
    const theirs = await call(`/orientation-videos/${V_THEIRS}`, "recruiter", { method: "PATCH", body: JSON.stringify({ required: false }) });
    expect(theirs.status).toBe(404);
  });

  it("offers no way to change a video's link", async () => {
    seed();
    const res = await call(`/orientation-videos/${V1}`, "recruiter", { method: "PATCH", body: JSON.stringify({ url: "https://v.example/9" }) });
    expect(res.status).toBe(400);
    expect(rec.writtenRows("orientation_videos")).toEqual([]);
  });
});

describe("one applicant's videos (the step's drawer)", () => {
  it("shows each video with when its link was first opened and which tick covered it, org-scoped", async () => {
    seed();
    const res = await call(`/applicants/${DRIVER}/orientation-videos`, "auditor");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      videos: Array<{ id: string; openedAt: string | null; attestedAt: string | null }>;
      sentAt: string | null; lastAttestation: { signerName: string } | null; canSend: boolean;
    };
    expect(body.videos).toEqual([
      expect.objectContaining({ id: V1, openedAt: null, attestedAt: "2026-10-21T10:00:00Z" }),
      expect.objectContaining({ id: V2, openedAt: "2026-10-20T11:00:00Z", attestedAt: null }),
    ]);
    expect(body.sentAt).toBe("2026-10-20T10:00:00Z");
    expect(body.lastAttestation?.signerName).toBe("Ana Plicant");
    expect(body.canSend).toBe(true);
    expectOrgScoped(rec, ORG);
  });

  it("refuses another carrier's applicant with a 404", async () => {
    seed();
    expect((await call(`/applicants/${OTHER_DRIVER}/orientation-videos`, "auditor")).status).toBe(404);
  });
});

describe("Send the videos", () => {
  it("rotates the application link with the send stamped in the same write, and audits it", async () => {
    seed();
    const res = await call(`/applicants/${DRIVER}/orientation-videos/send`, "recruiter", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sentAt: string; email: { reason: string | null }; text: { state: string } };
    const [written] = rec.writtenRows("application_invitations");
    expect(written).toMatchObject({ orientation_videos_sent_at: body.sentAt });
    expect(typeof written!.token_hash).toBe("string");
    expect(written!.token_hash).not.toBe(hashInvitationToken(TOKEN));
    expect(rec.writtenRows("audit_logs").map((a) => a.action)).toContain("compliance.orientation_videos_sent");
    // Never the link itself in the answer: it went to the applicant.
    expect(JSON.stringify(body)).not.toContain("/apply/");
    expectOrgScoped(rec, ORG);
  });

  it("says to send the invitation first when there is no live link", async () => {
    seed({ invitations: [] });
    const res = await call(`/applicants/${DRIVER}/orientation-videos/send`, "recruiter", { method: "POST" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("needs_invitation");
    expect(rec.writtenRows("application_invitations")).toEqual([]);
  });

  it("says to add the videos in Settings → Recruiting when the list is empty", async () => {
    seed({ videos: [] });
    const res = await call(`/applicants/${DRIVER}/orientation-videos/send`, "recruiter", { method: "POST" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("no_videos");
    expect(rec.writtenRows("application_invitations")).toEqual([]);
  });

  it("is refused to a viewer before any query", async () => {
    seed();
    expect((await call(`/applicants/${DRIVER}/orientation-videos/send`, "auditor", { method: "POST" })).status).toBe(403);
    expect(rec.queries).toHaveLength(0);
  });
});

describe("the applicant's page on their link", () => {
  it("lists the carrier's live videos with the ones already ticked", async () => {
    seed();
    const res = await pub(`${TOKEN}/videos`);
    expect(res.status).toBe(200);
    const page = (await res.json()) as { carrier: string; videos: Array<{ id: string; attested: boolean }> };
    expect(page.carrier).toBe("Silvicom Inc");
    expect(page.videos).toEqual([
      expect.objectContaining({ id: V1, attested: true }),
      expect.objectContaining({ id: V2, attested: false }),
    ]);
    expectOrgScoped(rec, ORG, TOKEN_LOOKUP);
  });

  it("records 'I watched these' with the name, the videos and the request's context, on this applicant", async () => {
    seed();
    const res = await pub(`${TOKEN}/videos/attest`, { method: "POST", body: JSON.stringify({ name: "  Ana Plicant ", videoIds: [V1, V2] }) });
    expect(res.status).toBe(201);
    expect(rec.writtenRows("orientation_video_attestations")).toEqual([{
      org_id: ORG, driver_id: DRIVER, invitation_id: INV, video_ids: [V1, V2], signer_name: "Ana Plicant",
      ip: expect.any(String), user_agent: "phone",
    }]);
    expectOrgScoped(rec, ORG, TOKEN_LOOKUP);
  });

  it("records a pressed link as opened, on this applicant", async () => {
    seed();
    const res = await pub(`${TOKEN}/videos/${V2}/opened`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(rec.writtenRows("orientation_video_opens")).toEqual([{ org_id: ORG, driver_id: DRIVER, invitation_id: INV, video_id: V2 }]);
  });

  it("refuses a dead link with the surface's one neutral answer, and a blank name before any write", async () => {
    seed();
    expect((await pub(`${"x".repeat(43)}/videos`)).status).toBe(404);
    const blank = await pub(`${TOKEN}/videos/attest`, { method: "POST", body: JSON.stringify({ name: "  ", videoIds: [V1] }) });
    expect(blank.status).toBe(400);
    expect(rec.writtenRows("orientation_video_attestations")).toEqual([]);
  });
});
