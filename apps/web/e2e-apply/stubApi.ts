import type { Page, Request, Route } from "@playwright/test";

/**
 * A fake of the applicant's public API, for the browser specs (C3d3b1).
 *
 * ── RAW JSON, AS THE SURFACE ANSWERS ────────────────────────────────────────────────────────────
 * `/api/public/application/**` has no `{ ok, data }` envelope: the bundle is the object itself and an
 * error is `{ error: { code, message } }` (`publicFetch`). A stub in the envelope would load a page
 * that reads `undefined` everywhere and still passes a careless assertion.
 *
 * ── STATEFUL, AND ONLY AS FAR AS THE SPECS NEED ─────────────────────────────────────────────────
 * The fake keeps what a real server would remember between a request and a reload — the draft and its
 * revision, the photographs confirmed, Part 1's writes — so a reload meets the state the page left.
 * Every request is recorded in `calls`, bodies parsed, so a spec asserts what the page SENT.
 *
 * ── THE NETWORK CUT ─────────────────────────────────────────────────────────────────────────────
 * `cut(pattern)` makes matching requests fail as a dropped connection does (`internetdisconnected`),
 * not as an error answer: the page's handling of "no signal" is the thing under test, and a 500 is a
 * different branch. `restore()` ends it.
 *
 * ⚠ Everything that is not the page's own origin is refused — Supabase, Sentry, fonts. The specs must
 * never reach a real service, and a request nobody stubbed failing loudly is better than one quietly
 * answered by production.
 */

/** Where `playwright.apply.config.ts` serves the built app — one number, read by both. */
export const APPLY_E2E_PORT = 4191;
export const ORIGIN = `http://127.0.0.1:${APPLY_E2E_PORT}`;

export const TOKEN = "e2e".repeat(14) + "x";
export const CARRIER = "Silvicom Inc";
const NOW = "2026-09-28T15:00:00.000Z";

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

type Json = Record<string, unknown>;

export interface StubState {
  bundle: Json;
  /** The server's copy of the draft, and its revision (0376). */
  draft: { payload: Json | null; revision: number };
  captures: Json[];
  calls: Call[];
  /** Bytes the storage upload received, keyed by capture id — to prove a resend sent the same photo. */
  uploads: Map<string, Buffer>;
  /** Bytes each CUT upload carried, in order — what a resend must match. */
  cutBodies: Buffer[];
  cutPatterns: RegExp[];
}

export interface Stub {
  state: StubState;
  cut(pattern: RegExp): void;
  restore(): void;
  /** Calls whose path matches, in order. */
  callsTo(method: string, pattern: RegExp): Call[];
}

/** Two published permissions — enough for a ceremony, and nothing reads a third. */
const RELEASES = [
  { purpose: "fcra_disclosure", version: "v1", title: "Disclosure regarding background reports", citation: "c", body: "b", intent: "i", draft: false },
  { purpose: "psp", version: "v1", title: "PSP disclosure and authorization", citation: "c", body: "b", intent: "i", draft: false },
];

const PHASES_NONE = {
  consentedAt: null, releasesCompletedAt: null, reviewRequestedAt: null, approvedAt: null,
  submittedAt: null, applicationSentAt: null, signingOpenedAt: null,
};

/**
 * A v2 link that has consented and has not finished Part 1, with the CDL's two sides already on file
 * unless `captures` says otherwise — so it opens on "About you" (`resumeScreen`).
 */
export function partOneLink(over: { captures?: Json[] } = {}): Json {
  return {
    carrier: CARRIER, carrierAddress: null, carrierToday: "2026-09-28", expiresAt: "2099-01-01T00:00:00Z",
    localKey: "e2e-local-key-part-one",
    releases: RELEASES, releasesSigned: [],
    phases: { ...PHASES_NONE, consentedAt: NOW },
    draft: { locked: false, payload: null, furthestSection: null, updatedAt: null, revision: 0 },
    esignConsent: { version: "v1", title: "t", citation: "c", body: "b", intent: "i", draft: false, required: true },
    captures: over.captures ?? [
      { slot: "cdl_front", contentType: "image/webp", bytes: 1000, capturedAt: NOW },
      { slot: "cdl_back", contentType: "image/webp", bytes: 1000, capturedAt: NOW },
    ],
    edits: [], packet: [], packetAdopted: null, identityComplete: false, roadTestCertificate: null, handbook: null,
    partOne: {
      completedAt: null, contact: false, address: false, licences: false, screening: false,
      medicalCardPending: false, rights: false,
    },
    fcraSummary: {
      version: "e2e", sourceUrl: "https://example.test", spanishNote: "n", title: "A Summary of Your Rights",
      intro: ["intro"], rights: [], closing: "closing", contactsHeading: { business: "b", contact: "c" }, contacts: [],
    },
  };
}

/** A legacy link whose form the office has sent, with an unlocked draft at `revision`. */
export function partTwoLink(payload: Json, revision: number): Json {
  return {
    carrier: CARRIER, carrierAddress: null, carrierToday: "2026-09-28", expiresAt: "2099-01-01T00:00:00Z",
    localKey: "e2e-local-key-part-two",
    releases: RELEASES, releasesSigned: ["fcra_disclosure", "psp"],
    phases: { ...PHASES_NONE, consentedAt: NOW, releasesCompletedAt: NOW, applicationSentAt: NOW },
    draft: { locked: false, payload, furthestSection: "identity", updatedAt: NOW, revision },
    esignConsent: { version: "v1", title: "t", citation: "c", body: "b", intent: "i", draft: false, required: true },
    captures: [], edits: [], packet: [], packetAdopted: null, identityComplete: true,
    roadTestCertificate: null, handbook: null, partOne: null, fcraSummary: null,
  };
}

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const parse = (req: Request): unknown => {
  const raw = req.postDataBuffer();
  if (!raw || raw.length === 0) return null;
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    return null;
  }
};

export async function stubApi(page: Page, bundle: Json): Promise<Stub> {
  const draft = bundle.draft as { payload: Json | null; revision?: number };
  const state: StubState = {
    bundle,
    draft: { payload: draft.payload, revision: draft.revision ?? 0 },
    captures: [...(bundle.captures as Json[])],
    calls: [],
    uploads: new Map(),
    cutBodies: [],
    cutPatterns: [],
  };
  const origin = ORIGIN;
  let seq = 0;

  // Anything that is not this origin: refused (see the header).
  await page.route((url) => url.origin !== origin, (route) => route.abort("blockedbyclient"));

  // The storage upload the capture start hands out, on this origin so no real bucket is ever named.
  await page.route(`${origin}/__storage/**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    state.calls.push({ method: req.method(), path, body: null });
    const bytes = req.postDataBuffer() ?? Buffer.alloc(0);
    if (state.cutPatterns.some((p) => p.test(path))) {
      state.cutBodies.push(bytes);
      return route.abort("internetdisconnected");
    }
    state.uploads.set(path.split("/").pop()!, bytes);
    return route.fulfill({ status: 200, body: "" });
  });

  await page.route(`${origin}/api/public/application/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace("/api/public/application", "");
    const method = req.method();
    const body = parse(req);
    state.calls.push({ method, path, body });
    if (state.cutPatterns.some((p) => p.test(path))) return route.abort("internetdisconnected");

    const rest = path.replace(`/${TOKEN}`, "");
    if (method === "GET" && rest === "") {
      return json(route, 200, {
        ...state.bundle,
        draft: { ...(state.bundle.draft as Json), payload: state.draft.payload, revision: state.draft.revision },
        captures: state.captures,
      });
    }
    if (method === "PUT" && rest === "/draft") {
      const b = body as { payload: Json; revision?: number };
      if (b.revision !== undefined && b.revision !== state.draft.revision) {
        return json(route, 409, { error: { code: "draft_revision_conflict", message: "Someone else saved first." } });
      }
      state.draft = { payload: b.payload, revision: state.draft.revision + 1 };
      return json(route, 200, { ok: true, updatedAt: NOW, revision: state.draft.revision });
    }
    if (method === "POST" && rest === "/capture") {
      const b = body as { slot: string; content_type: string };
      const captureId = `cap-${++seq}`;
      return json(route, 201, {
        captureId, storagePath: `e2e/${captureId}`, uploadToken: "t",
        uploadUrl: `${origin}/__storage/upload/${captureId}`, slot: b.slot,
      });
    }
    const confirm = /^\/capture\/([^/]+)$/.exec(rest);
    if (method === "PUT" && confirm) {
      const b = body as { slot: string; content_type: string };
      state.captures = [
        ...state.captures.filter((c) => c.slot !== b.slot),
        { slot: b.slot, contentType: b.content_type, bytes: state.uploads.get(confirm[1]!)?.length ?? 0, capturedAt: new Date().toISOString() },
      ];
      return json(route, 200, { slot: b.slot, capturedAt: new Date().toISOString() });
    }
    if (method === "POST" && rest === "/intake") return json(route, 201, { ok: true, keptExisting: [] });
    if (method === "POST" && rest === "/intake/licences") return json(route, 201, { ok: true, keptExisting: [], licenceCount: 1 });
    if (method === "POST" && rest === "/identity") return json(route, 201, { ok: true, keptExisting: [] });
    if (method === "POST" && rest === "/screen-events") return json(route, 200, { ok: true, inserted: 0, closed: 0 });
    // Anything else the page asks for is a route this fake does not know — say so in the failure.
    return json(route, 501, { error: { code: "not_stubbed", message: `e2e stub: ${method} ${rest}` } });
  });

  return {
    state,
    cut: (pattern) => void state.cutPatterns.push(pattern),
    restore: () => void (state.cutPatterns.length = 0),
    callsTo: (method, pattern) => state.calls.filter((c) => c.method === method && pattern.test(c.path)),
  };
}
