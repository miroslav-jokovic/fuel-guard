import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RECRUITING_MESSAGE_KEYS, type AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * Settings → Recruiting's "Messages" through the mount (HIRING-WORKFLOW-AUDIT §12 MT2, 0551): the section
 * gate, newest-wins reading, a save as a new row with the session's name, the placeholder and GSM-7
 * refusals as 400s, and an audit row that never carries the words.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ctx = (role: string): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = { admin: ctx("admin"), auditor: ctx("auditor"), dispatcher: ctx("dispatcher") };

let server: Server;
let baseUrl: string;

const call = (method: string, path: string, token: string, body?: unknown) =>
  fetch(`${baseUrl}/api/recruitment${path}`, {
    method,
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

type Row = Record<string, unknown> & { message_key: string; saved_at: string };

/** 0551's newest-wins read, done by the fixture: the rows of the asked key, newest first. */
const seed = (rows: Row[] = []): SupabaseRecorder => createSupabaseRecorder({
  tables: {
    recruiting_message_wording: (q: RecordedQuery) => {
      if (q.write) {
        return [{ ...(q.write.payload as Record<string, unknown>), saved_at: "2026-11-03T10:00:00Z" }];
      }
      const key = q.filters().find((f) => f.col === "message_key")?.val;
      return rows.filter((r) => r.message_key === key).sort((a, b) => b.saved_at.localeCompare(a.saved_at));
    },
    organizations: [{ id: ORG, name: "Acme Freight" }],
    audit_logs: [],
  },
});

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

// `displayNameFor` reads the signed-in person's own profile by user id — a person, not a tenant's row.
const PROFILE_EXEMPT = { exempt: ["user_profiles"] };

const parts = { emailSubject: null, emailHeading: null, emailParagraph: null, textLead: null };

describe("reading", () => {
  it("lists every catalogue message as the standard words when nothing is saved, to anybody who can view recruiting", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await call("GET", "/messages", "auditor");
    expect(res.status).toBe(200);
    const { messages } = await res.json() as { messages: Array<{ key: string; wording: unknown; savedAt: unknown }> };
    expect(messages.map((m) => m.key)).toEqual([...RECRUITING_MESSAGE_KEYS]);
    expect(messages.every((m) => m.savedAt === null)).toBe(true);
    expect(messages[0]!.wording).toEqual(parts);
    expect((await (await call("GET", "/messages", "auditor")).json() as { carrier: string }).carrier).toBe("Acme Freight");
    expectOrgScoped(rec, ORG);
    expect((await call("GET", "/messages", "dispatcher")).status).toBe(403);
  });

  it("reads the NEWEST save of each message — a later reset to standard wins over an older wording", async () => {
    holder.client = seed([
      { message_key: "invitation", email_subject: "Old", email_heading: null, email_paragraph: null, text_lead: null, saved_by_name: "Dana", saved_at: "2026-11-01T10:00:00Z" },
      { message_key: "invitation", email_subject: null, email_heading: null, email_paragraph: null, text_lead: null, saved_by_name: "Lee", saved_at: "2026-11-02T10:00:00Z" },
      { message_key: "reminder", email_subject: "Come back", email_heading: null, email_paragraph: null, text_lead: null, saved_by_name: "Dana", saved_at: "2026-11-01T10:00:00Z" },
    ]).client;
    const { messages } = await (await call("GET", "/messages", "admin")).json() as {
      messages: Array<{ key: string; wording: { emailSubject: string | null }; savedByName: string | null }>;
    };
    const by = Object.fromEntries(messages.map((m) => [m.key, m]));
    expect(by.invitation!.wording.emailSubject).toBeNull();
    expect(by.invitation!.savedByName).toBe("Lee");
    expect(by.reminder!.wording.emailSubject).toBe("Come back");
  });
});

describe("saving", () => {
  it("saves a new row with the session's name, and audits which parts were written but never the words", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await call("PUT", "/messages/invitation", "admin", {
      ...parts, emailSubject: "  Hi {first_name}, your {carrier} application  ", textLead: "Start here:",
    });
    expect(res.status).toBe(200);
    const [row] = rec.writtenRows("recruiting_message_wording");
    expect(row).toMatchObject({
      org_id: ORG, message_key: "invitation", email_subject: "Hi {first_name}, your {carrier} application",
      email_heading: null, text_lead: "Start here:", saved_by: "u-admin", saved_by_name: "admin@x.test",
    });
    const [audit] = rec.writtenRows("audit_logs");
    expect(audit).toMatchObject({ action: "recruitment.message_wording_saved", meta: { message: "invitation", written: ["emailSubject", "textLead"] } });
    expect(JSON.stringify(audit)).not.toContain("your {carrier} application");
    expectOrgScoped(rec, ORG, PROFILE_EXEMPT);
  });

  it("an empty part is the standard words (null), so four empties is 'Use the standard wording'", async () => {
    const rec = seed();
    holder.client = rec.client;
    expect((await call("PUT", "/messages/videos", "admin", { emailSubject: "", emailHeading: " ", emailParagraph: null, textLead: "" })).status).toBe(200);
    expect(rec.writtenRows("recruiting_message_wording")[0]).toMatchObject({ email_subject: null, email_heading: null, email_paragraph: null, text_lead: null });
  });

  it("refuses a placeholder the message does not have, naming it, with nothing written", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await call("PUT", "/messages/reminder", "admin", { ...parts, emailParagraph: "You have {days} left" });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string; issues: Record<string, string> } };
    expect(body.error.code).toBe("invalid_wording");
    expect(body.error.issues.emailParagraph).toContain("{days}");
    expect(rec.writtenRows("recruiting_message_wording")).toHaveLength(0);
  });

  it("refuses a text lead with a curly quote (GSM-7), and a subject on two lines", async () => {
    const rec = seed();
    holder.client = rec.client;
    expect((await call("PUT", "/messages/invitation", "admin", { ...parts, textLead: "It’s ready:" })).status).toBe(400);
    expect((await call("PUT", "/messages/invitation", "admin", { ...parts, emailSubject: "Hi\nBcc: x" })).status).toBe(400);
    expect(rec.writtenRows("recruiting_message_wording")).toHaveLength(0);
  });

  it("refuses a part over its limit, and a save missing a part", async () => {
    holder.client = seed().client;
    expect((await call("PUT", "/messages/invitation", "admin", { ...parts, textLead: "x".repeat(121) })).status).toBe(400);
    expect((await call("PUT", "/messages/invitation", "admin", { emailSubject: "Hi" })).status).toBe(400);
  });

  it("answers 404 for a message the catalogue does not have, and 403 to a caller who can only view", async () => {
    const rec = seed();
    holder.client = rec.client;
    expect((await call("PUT", "/messages/travel_typo", "admin", parts)).status).toBe(404);
    expect((await call("PUT", "/messages/invitation", "auditor", parts)).status).toBe(403);
    expect(rec.writtenRows("recruiting_message_wording")).toHaveLength(0);
  });
});
