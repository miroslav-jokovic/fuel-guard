import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";
import { setAppLocals } from "../lib/appLocals.js";
import type { PlatformToken } from "../lib/auth.js";
import type { PlatformAdmin } from "../lib/platformAdmins.js";
import { STEP_UP_WINDOW_MS } from "../middleware/platformAuth.js";
import { candidateShaFrom } from "../lib/releaseApproval.js";
// @ts-expect-error — a plain .mjs script with no types; the marker's writer, imported to hold it to the reader.
import { candidateMarker } from "../../../../scripts/release-train.mjs";

/**
 * D-REL14 — tonight's release approved from the console (0440). These cases pin that an approval
 * ships the commit the notes describe, that a page gone stale is refused, that only a platform owner
 * with a fresh second factor on the PRODUCTION console may approve or withdraw, and that both reach
 * the audit trail.
 */
const SHA_NOTES = "a".repeat(40);
const SHA_HEAD = "b".repeat(40);

describe("candidateShaFrom", () => {
  it("reads the line release-candidate.yml writes", () =>
    expect(candidateShaFrom(`${candidateMarker(SHA_NOTES)}\n**Approve this PR**`)).toBe(SHA_NOTES));
  it("is null for a body written before the marker existed", () => expect(candidateShaFrom("**Approve this PR**")).toBeNull());
});

// ── Routes, against a fake GitHub and a fake service-role client ───────────────────────────────

const REPO = "miroslav-jokovic/fuel-guard";
const pull = (over: Record<string, unknown> = {}) => ({
  number: 1351,
  html_url: `https://github.com/${REPO}/pull/1351`,
  title: "Release candidate — main @ aaaaaaa",
  body: `${candidateMarker(SHA_NOTES)}\n**Approve this PR**\n\n**Fuel:**\n- #1350 Card fraud`,
  updated_at: "2026-10-08T23:00:00Z",
  head: { ref: "main", sha: SHA_HEAD, repo: { full_name: REPO } },
  ...over,
});

interface Row { id: string; pr_number: number; commit_sha: string; approved_by: string; approved_at: string; revoked_at: string | null }
interface Store { rows: Row[]; audit: { action: string; after: unknown; before: unknown }[] }

function fakeClient(store: Store): SupabaseClient {
  const approvals = () => {
    const where: Record<string, unknown> = {};
    let insert: Row | null = null;
    let patch: Partial<Row> | null = null;
    const live = () => store.rows.filter((r) => !r.revoked_at && (where.pr_number === undefined || r.pr_number === where.pr_number));
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.is = () => b;
    b.order = () => b;
    b.eq = (c: string, v: unknown) => ((where[c] = v), b);
    b.insert = (row: { pr_number: number; commit_sha: string; approved_by: string }) => {
      insert = { id: `r${store.rows.length + 1}`, approved_at: new Date(Date.now() + store.rows.length).toISOString(), revoked_at: null, ...row };
      return b;
    };
    b.update = (p: Partial<Row>) => ((patch = p), b);
    b.single = async () => (store.rows.push(insert!), { data: insert, error: null });
    b.then = (resolve: (v: unknown) => void) => {
      if (patch) {
        const hit = live();
        hit.forEach((r) => Object.assign(r, patch));
        return resolve({ data: hit, error: null });
      }
      return resolve({ data: [...live()].reverse(), error: null });
    };
    return b;
  };
  const admins = { select: () => admins, in: async () => ({ data: [{ id: "a1", email: "owner@example.com" }], error: null }) };
  return {
    from: (table: string) =>
      table === "platform_release_approvals"
        ? approvals()
        : table === "platform_admins"
          ? admins
          : { insert: async (row: Store["audit"][number]) => (store.audit.push(row), { error: null }) },
  } as unknown as SupabaseClient;
}

const secondsAgo = (n: number) => Math.floor((Date.now() - n * 1000) / 1000);
const freshMfa = (): PlatformToken => ({
  userId: "u1", email: "owner@example.com", aal: "aal2",
  amr: [{ method: "totp", timestamp: secondsAgo(30) }], sessionId: "s1",
});
const staleMfa = (): PlatformToken => ({ ...freshMfa(), amr: [{ method: "totp", timestamp: secondsAgo(STEP_UP_WINDOW_MS / 1000 + 60) }] });
const owner: PlatformAdmin = { id: "a1", email: "owner@example.com", userId: "u1", role: "platform_owner", status: "active", mfaEnrolledAt: "x", lastReauthAt: null };
const platformAdmin: PlatformAdmin = { ...owner, id: "a2", role: "platform_admin" };
const H = { authorization: "Bearer x", "content-type": "application/json" };

let server: Server | null = null;
afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
});

async function start(opts: { who?: PlatformAdmin; token?: () => PlatformToken; branch?: string; pulls?: unknown[]; githubStatus?: number } = {}) {
  const store: Store = { rows: [], audit: [] };
  const env = loadEnv({ NODE_ENV: "test", RAILWAY_GIT_BRANCH: opts.branch ?? "production" } as NodeJS.ProcessEnv);
  const app = createApp(env);
  const pulls = { current: opts.pulls ?? [pull()] };
  setAppLocals(app, {
    verifyToken: async () => (opts.token ?? freshMfa)(),
    lookupPlatformAdmin: async () => opts.who ?? owner,
    supabaseAdmin: fakeClient(store),
    fetchGitHub: (async () =>
      opts.githubStatus ? new Response("rate limited", { status: opts.githubStatus }) : new Response(JSON.stringify(pulls.current))) as typeof fetch,
  });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/admin/release`, store, pulls };
}
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: H, body: JSON.stringify(body) });

describe("/admin/release", () => {
  it("shows tonight's PR with the commit its notes describe, and the notes without the marker", async () => {
    const { base } = await start();
    const body = (await (await fetch(base, { headers: H })).json()) as {
      candidate: { number: number; shipsSha: string; pinnedByNotes: boolean; notes: string };
      canApprove: boolean;
    };
    expect(body.candidate).toMatchObject({ number: 1351, shipsSha: SHA_NOTES, pinnedByNotes: true });
    expect(body.candidate.notes.startsWith("**Approve this PR**")).toBe(true);
    expect(body.canApprove).toBe(true);
  });

  it("without a marker, an approval would ship main's head, and the page is told so", async () => {
    const { base } = await start({ pulls: [pull({ body: "**Approve this PR**" })] });
    const body = (await (await fetch(base, { headers: H })).json()) as { candidate: { shipsSha: string; pinnedByNotes: boolean } };
    expect(body.candidate).toMatchObject({ shipsSha: SHA_HEAD, pinnedByNotes: false });
  });

  it("no open main → production PR means no candidate", async () => {
    const { base } = await start({ pulls: [pull({ head: { ref: "claude/x", sha: SHA_HEAD, repo: { full_name: REPO } } })] });
    expect(((await (await fetch(base, { headers: H })).json()) as { candidate: unknown }).candidate).toBeNull();
  });

  it("the owner approves the notes' commit, it is listed, and it is audited", async () => {
    const { base, store } = await start();
    const res = await post(`${base}/approve`, { prNumber: 1351, commitSha: SHA_NOTES });
    expect(res.status).toBe(201);
    expect(store.rows).toEqual([expect.objectContaining({ pr_number: 1351, commit_sha: SHA_NOTES, approved_by: "a1" })]);
    expect(((await res.json()) as { approvals: { approvedBy: string }[] }).approvals[0]!.approvedBy).toBe("owner@example.com");
    expect(store.audit).toEqual([expect.objectContaining({ action: "release.approve", after: expect.objectContaining({ commitSha: SHA_NOTES }) })]);
  });

  it("refuses a page gone stale: a refreshed PR, or a different commit than the notes'", async () => {
    const { base, store, pulls } = await start();
    expect((await post(`${base}/approve`, { prNumber: 1351, commitSha: SHA_HEAD })).status).toBe(409);
    pulls.current = [pull({ number: 1360 })];
    const res = await post(`${base}/approve`, { prNumber: 1351, commitSha: SHA_NOTES });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("stale");
    expect(store.rows).toHaveLength(0);
  });

  it("only the production console may approve: uat writes a database release.yml never reads", async () => {
    const { base, store } = await start({ branch: "main" });
    expect(((await (await fetch(base, { headers: H })).json()) as { canApprove: boolean }).canApprove).toBe(false);
    const res = await post(`${base}/approve`, { prNumber: 1351, commitSha: SHA_NOTES });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_production");
    expect(store.rows).toHaveLength(0);
  });

  it("a platform admin who is not the owner may look, but not approve", async () => {
    const { base, store } = await start({ who: platformAdmin });
    expect((await fetch(base, { headers: H })).status).toBe(200);
    expect((await post(`${base}/approve`, { prNumber: 1351, commitSha: SHA_NOTES })).status).toBe(403);
    expect(store.rows).toHaveLength(0);
  });

  it("approving needs a second factor proved just now", async () => {
    const { base, store } = await start({ token: staleMfa });
    const res = await post(`${base}/approve`, { prNumber: 1351, commitSha: SHA_NOTES });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("step_up_required");
    expect(store.rows).toHaveLength(0);
  });

  it("withdrawing stamps the live approvals, audits it, and a second withdraw finds nothing", async () => {
    const { base, store } = await start();
    await post(`${base}/approve`, { prNumber: 1351, commitSha: SHA_NOTES });
    expect((await post(`${base}/revoke`, { prNumber: 1351 })).status).toBe(200);
    expect(store.rows[0]!.revoked_at).not.toBeNull();
    expect(store.audit.map((a) => a.action)).toEqual(["release.approve", "release.revoke"]);
    expect((await post(`${base}/revoke`, { prNumber: 1351 })).status).toBe(404);
  });

  it("GitHub unreachable is said plainly, not as an empty release", async () => {
    const { base } = await start({ githubStatus: 403 });
    const res = await fetch(base, { headers: H });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("github_unavailable");
  });
});
