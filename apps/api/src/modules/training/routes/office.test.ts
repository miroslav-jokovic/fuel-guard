import { describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * Safety → Training's API (D-TR3, D-TR11): reading needs `safety: view`, sending needs `safety: manage`;
 * a hired driver is never texted; the office gets a link back ONLY when it must deliver it itself; every
 * send is audited; every query names the caller's org.
 */

const ORG = "33333333-3333-4333-8333-333333333333";
const USER = "user-1";
const COURSE = "55555555-5555-4555-8555-555555555555";
const HIRED = "11111111-1111-4111-8111-111111111111";
const APPLICANT = "22222222-2222-4222-8222-222222222222";
const MAILED = "66666666-6666-4666-8666-666666666666";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: { WEB_APP_URL: "https://360.example.test" } }) }));
const mail = vi.hoisted(() => ({ sendEmail: vi.fn(async () => ({ ok: true, provider: "brevo" })) }));
vi.mock("../../../lib/mailer.js", () => mail);
const audit = vi.hoisted(() => ({ writeAudit: vi.fn(async () => true) }));
vi.mock("../../../lib/audit.js", () => audit);
vi.mock("../../../middleware/requireModule.js", () => ({ requireModule: () => (_q: Request, _s: Response, n: NextFunction) => n() }));
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: USER, orgId: ORG, role: "safety_manager", email: "s@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireSection:
    (section: string, level: "view" | "manage" = "manage") =>
    (req: Request, res: Response, next: NextFunction) => {
      const [s, l] = String(req.headers["x-grants"] ?? "safety:manage").split(":");
      if (s === section && (l === "manage" || l === level)) next();
      else res.status(403).json({ ok: false, error: { code: "forbidden", message: "no" } });
    },
}));

const queue = vi.hoisted(() => ({ enqueue: vi.fn(async (): Promise<{ jobId: string } | { conflict: true }> => ({ jobId: "job-1" })), drainKindNow: vi.fn(async () => 1) }));
vi.mock("../../../queue/pgDriver.js", () => ({ pgQueueDriver: () => ({ enqueue: queue.enqueue }) }));
vi.mock("../../../queue/inprocessDrain.js", () => ({ drainKindNow: queue.drainKindNow }));

const texted: string[] = [];
const texter = {
  canText: vi.fn(async (_a: unknown, _e: unknown, _o: string, _d: string, status: string) => ({ ok: status === "applicant", reason: status === "applicant" ? null : "Texting hired drivers is not set up yet." })),
  send: vi.fn(async (_a: unknown, _e: unknown, _o: string, driverId: string) => {
    texted.push(driverId);
    return { ok: true, detail: null };
  }),
};

const { trainingRouter } = await import("./office.js");

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use("/api/training", trainingRouter({ texter }));
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/training`);
  } finally {
    await closeTestServer(server);
  }
}
const post = (url: string, body: unknown, grants?: string) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(grants ? { "x-grants": grants } : {}) }, body: JSON.stringify(body) });

function seed() {
  let n = 0;
  rec = createSupabaseRecorder({
    tables: {
      training_courses: [{ id: COURSE, title: "Act I", retired_at: null }],
      organizations: [{ name: "Silvicom Inc" }],
      drivers: [
        { id: HIRED, full_name: "Marko Petrovic", email: null, phone: "+13125550141", status: "active" },
        { id: APPLICANT, full_name: "Kevin Brooks", email: "k@example.test", phone: "+18155550133", status: "applicant" },
        { id: MAILED, full_name: "Ana Morales", email: "ana@example.test", phone: null, status: "active" },
      ],
      training_assignments: (q: RecordedQuery) => (q.write?.method === "insert" ? [{ id: `aaaaaaa${n++}-aaaa-4aaa-8aaa-aaaaaaaaaaaa` }] : []),
    },
  });
}

describe("sending training to a phone number (0663)", () => {
  it("makes the link for a named person outside the roster, keeps the number in +1 form, texts nothing and hands the office the link", async () => {
    seed();
    texted.length = 0;
    mail.sendEmail.mockClear();
    audit.writeAudit.mockClear();
    const res = await withServer((b) => post(`${b}/assignments/phone`, { name: "Jordan Reyes", phone: "(312) 555-0188", courseId: COURSE }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { sent: { driverId: string | null; via: string; link: string | null } };
    expect(body.sent).toMatchObject({ driverId: null, via: "copy" });
    expect(body.sent.link).toMatch(/^https:\/\/360\.example\.test\/t\/[A-Za-z0-9_-]{24}$/);
    const [row] = rec.writtenRows("training_assignments");
    expect(row).toMatchObject({ driver_id: null, recipient_name: "Jordan Reyes", recipient_phone: "+13125550188", last_sent_via: "copy" });
    expect(String(row!.token_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(texted).toEqual([]);
    expect(mail.sendEmail).not.toHaveBeenCalled();
    expect(audit.writeAudit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(audit.writeAudit.mock.calls[0])).not.toContain("5550188");
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });

  it("refuses a number that is not a dialable US or Canada one, before anything is written", async () => {
    seed();
    for (const phone of ["555-0188", "(123) 456-7890", "+44 20 7946 0958"]) {
      const res = await withServer((b) => post(`${b}/assignments/phone`, { name: "Jordan Reyes", phone, courseId: COURSE }));
      expect(res.status, phone).toBe(422);
    }
    expect(rec.writtenRows("training_assignments")).toEqual([]);
  });

  it("needs a name, and safety: manage", async () => {
    seed();
    expect((await withServer((b) => post(`${b}/assignments/phone`, { name: " ", phone: "3125550188", courseId: COURSE }))).status).toBe(400);
    expect((await withServer((b) => post(`${b}/assignments/phone`, { name: "Jordan Reyes", phone: "3125550188", courseId: COURSE }, "safety:view"))).status).toBe(403);
  });
});

describe("sending training", () => {
  it("texts the applicant, emails the hired driver with an address, and hands the office the link only for the one it must deliver", async () => {
    seed();
    audit.writeAudit.mockClear(); // counted below, so not the calls of tests before this one
    const res = await withServer((b) => post(`${b}/assignments`, { driverIds: [HIRED, APPLICANT, MAILED], courseId: COURSE }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { sent: Array<{ driverId: string; via: string; link: string | null }> };
    const by = Object.fromEntries(body.sent.map((s) => [s.driverId, s]));
    expect(by[APPLICANT]).toMatchObject({ via: "sms", link: null });
    expect(by[MAILED]).toMatchObject({ via: "email", link: null });
    expect(by[HIRED]!.via).toBe("copy");
    expect(by[HIRED]!.link).toMatch(/^https:\/\/360\.example\.test\/t\/[A-Za-z0-9_-]{24}$/);
    expect(texted).toEqual([APPLICANT]);
    // Only a hash is stored; the token is never written.
    for (const row of rec.writtenRows("training_assignments").filter((r) => "token_hash" in r)) expect(String(row.token_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(audit.writeAudit).toHaveBeenCalledTimes(3);
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });

  it("needs safety: manage to send, and safety: view to read", async () => {
    seed();
    const refused = await withServer((b) => post(`${b}/assignments`, { driverIds: [HIRED], courseId: COURSE }, "safety:view"));
    expect(refused.status).toBe(403);
    const read = await withServer((b) => fetch(`${b}/assignments`, { headers: { "x-grants": "safety:view" } }));
    expect(read.status).toBe(200);
  });

  it("refuses a driver from another company", async () => {
    seed();
    const res = await withServer((b) => post(`${b}/assignments`, { driverIds: ["99999999-9999-4999-8999-999999999999", HIRED], courseId: COURSE }));
    expect(res.status).toBe(404);
  });
});

describe("watching a film in the office", () => {
  const READY = "77777777-7777-4777-8777-777777777777";
  const PROCESSING = "88888888-8888-4888-8888-888888888888";
  function seedFilms() {
    rec = createSupabaseRecorder({
      tables: {
        training_versions: (q: RecordedQuery) => {
          const id = q.filters().find((f) => f.col === "id")?.val;
          if (id === READY) return [{ id, duration_ms: 204_000, renditions: [{ height: 720, path: "o/l/v/720.mp4" }, { height: 360, path: "o/l/v/360.mp4" }] }];
          if (id === PROCESSING) return [{ id, duration_ms: null, renditions: [] }];
          return [];
        },
      },
      storage: { createSignedUrls: (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed.test/${p}` })), error: null }) },
    });
  }

  it("hands a viewer a link to the smallest version, so marking chapters loads quickly", async () => {
    seedFilms();
    const res = await withServer((b) => fetch(`${b}/versions/${READY}/preview`, { headers: { "x-grants": "safety:view" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ url: "https://signed.test/o/l/v/360.mp4", durationMs: 204_000 });
    expect(rec.storageCalls()).toEqual([{ bucket: "training-media", fn: "createSignedUrls", args: [["o/l/v/360.mp4"], 3600] }]);
    expectOrgScoped(rec, ORG);
  });

  it("says a film still being prepared is not ready, and an unknown one does not exist", async () => {
    seedFilms();
    const busy = await withServer((b) => fetch(`${b}/versions/${PROCESSING}/preview`));
    expect(busy.status).toBe(409);
    const none = await withServer((b) => fetch(`${b}/versions/99999999-9999-4999-8999-999999999999/preview`));
    expect(none.status).toBe(404);
    expect(rec.storageCalls()).toEqual([]);
  });
});

describe("preparing an uploaded film", () => {
  const V = "77777777-7777-4777-8777-777777777777";
  const seedProcessing = () => {
    rec = createSupabaseRecorder({ tables: { training_versions: [{ id: V, state: "processing", chapters: [] }] } });
  };

  it("queues the film and starts preparing it at once", async () => {
    seedProcessing();
    queue.enqueue.mockClear();
    queue.drainKindNow.mockClear();
    const res = await withServer((b) => post(`${b}/versions/${V}/uploaded`, {}));
    expect(res.status).toBe(200);
    expect(queue.enqueue).toHaveBeenCalledWith("training_transcode", expect.objectContaining({ dedupKey: `training_transcode:${V}` }));
    expect(queue.drainKindNow).toHaveBeenCalledWith(expect.anything(), expect.anything(), "training_transcode", 1);
  });

  it("starts the queue again when the office retries a film whose job is already queued, instead of a 500", async () => {
    seedProcessing();
    queue.enqueue.mockClear().mockResolvedValueOnce({ conflict: true });
    queue.drainKindNow.mockClear();
    const res = await withServer((b) => post(`${b}/versions/${V}/uploaded`, {}));
    expect(res.status).toBe(200);
    expect(queue.drainKindNow).toHaveBeenCalledTimes(1);
    expect(audit.writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "training.video_uploaded", entityId: V }));
  });

  it("still fails on any other queue error", async () => {
    seedProcessing();
    queue.enqueue.mockClear().mockRejectedValueOnce(new Error("database down"));
    queue.drainKindNow.mockClear();
    const res = await withServer((b) => post(`${b}/versions/${V}/uploaded`, {}));
    expect(res.status).toBe(500);
    expect(queue.drainKindNow).not.toHaveBeenCalled();
  });
});

describe("publishing a film (D-TR14, D-TR15)", () => {
  const V = "77777777-7777-4777-8777-777777777777";
  const CH = [{ title: "Why space", startMs: 8000 }, { title: "Count it", startMs: 86_000 }];
  const bank = (skip?: { chapter: number; point: number; v: number }) =>
    [0, 1].flatMap((chapter) => [0, 1, 2].flatMap((point) => [0, 1].map((v) => ({ chapter, point, v }))))
      .filter((q) => !(skip && q.chapter === skip.chapter && q.point === skip.point && q.v === skip.v))
      .map(({ chapter, point }) => ({ chapter, point }));
  function seedVersion(state: string, questions: Array<{ chapter: number; point: number }>) {
    rec = createSupabaseRecorder({
      tables: { training_versions: [{ state, chapters: CH }], training_questions: questions },
      rpc: { training_publish_version: null },
    });
  }

  it("refuses a film whose point has one version, naming the segment, before the swap is asked for", async () => {
    seedVersion("ready", bank({ chapter: 1, point: 2, v: 1 }));
    const res = await withServer((b) => post(`${b}/versions/${V}/publish`, {}));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe('"Count it", point 3 has one version: write a second, so a retry asks something different.');
    expect(rec.rpcs()).toEqual([]);
    expectOrgScoped(rec, ORG);
  });

  it("publishes a ready film whose every segment has 3 points in two versions", async () => {
    seedVersion("ready", bank());
    const res = await withServer((b) => post(`${b}/versions/${V}/publish`, {}));
    expect(res.status).toBe(200);
    expect(rec.rpcs().map((r) => r.fn)).toEqual(["training_publish_version"]);
  });
});
