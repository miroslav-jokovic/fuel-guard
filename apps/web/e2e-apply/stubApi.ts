import type { Page, Request, Route } from "@playwright/test";
import { driverPlacements, PERMISSION_SIGNATURE_DESTINATION } from "@silvicom/shared";

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
  /** Requests this fake had no answer for — a spec asserts it is empty, so a walk never passes on a 501. */
  unstubbed: string[];
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

/**
 * A Letter-sized PDF of `pages` pages, each saying its number — the permissions, the packet and the
 * handbook the page renders with pdfjs.
 *
 * Written by hand rather than with a PDF library, because the web app has none and pdfjs needs very
 * little. `signHere` names the permission's signature box as the api's renderer does (AF6): the box's
 * top-left as an XYZ point in the catalogue's `/Dests`, which `signatureBox.ts` turns into the **Sign
 * here** tag's place and SIZE. The size is the point — the tag is as big as the box the renderer drew,
 * scaled to the phone, so a spec that measures it needs the real proportions: `PERMISSION_SIGNATURE_BOX`
 * over a 612-point page, as the renderer's is.
 */
function letterPdf(pages: number, signHere = false): Buffer {
  // 1 catalogue, 2 page tree, 3 font, then a page and its content stream per page.
  const pageRef = (i: number) => `${4 + i * 2} 0 R`;
  const dests = signHere ? ` /Dests << /${PERMISSION_SIGNATURE_DESTINATION} [${pageRef(0)} /XYZ 72 200 0] >>` : "";
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R${dests} >>`,
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => pageRef(i)).join(" ")}] /Count ${pages} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let i = 0; i < pages; i += 1) {
    const text = `BT /F1 12 Tf 72 700 Td (Page ${i + 1}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
      `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    );
  }
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) pdf += `${String(at).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const pdf = (route: Route, body: Buffer) => route.fulfill({ status: 200, contentType: "application/pdf", body });

/** The carrier's packet is 31 pages (`packetPlacements.ts`); every served stop names one of them. */
const PACKET_PAGES = 31;

/**
 * A v2 link at its second visit: Part 1 done, permissions signed, the form sent and the draft unlocked
 * (no date of birth in it, so no gate). `phases` is laid over that — approved, filed — and so is the
 * rest of `over`: a locked draft, the packet's stops, the handbook.
 */
export function partTwoV2Link(over: Json = {}): Json {
  const { phases, ...rest } = over;
  return {
    ...partOneLink(),
    releasesSigned: RELEASES.map((r) => r.purpose),
    phases: { ...PHASES_NONE, consentedAt: NOW, releasesCompletedAt: NOW, applicationSentAt: NOW, ...(phases as Json | undefined) },
    draft: { locked: false, payload: { first_name: "Susan", last_name: "Godfrey" }, furthestSection: "identity", updatedAt: NOW, revision: 1 },
    partOne: {
      completedAt: NOW, contact: true, address: true, licences: true, screening: true, medicalCardPending: false, rights: true,
    },
    identityComplete: true,
    fcraSummary: null,
    ...rest,
  };
}

/** The packet's driver stops as the server serves them — nothing signed yet. */
export const packetStops = (): Json[] => driverPlacements(null).map((p) => ({ ...p, signedAt: null }));

/** The handbook as a filed link sees it once the office has opened it, with a signature to borrow. */
export const openHandbook = (): Json => ({
  canOpen: true, openedAt: NOW, driverSigned: [], driverComplete: false, filedAt: null,
  adoption: null, version: "e2e",
});

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
    unstubbed: [],
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
    if (method === "POST" && rest === "/consent") {
      state.bundle = { ...state.bundle, phases: { ...(state.bundle.phases as Json), consentedAt: NOW } };
      return json(route, 201, { ok: true });
    }
    if (method === "POST" && rest === "/intake/complete") {
      state.bundle = { ...state.bundle, partOne: { ...(state.bundle.partOne as Json), completedAt: NOW } };
      return json(route, 200, { ok: true });
    }
    if (method === "POST" && rest === "/release") {
      const b = body as { purpose: string };
      const signed = [...(state.bundle.releasesSigned as string[]), b.purpose];
      state.bundle = { ...state.bundle, releasesSigned: signed };
      return json(route, 201, { signedCount: signed.length, completed: signed.length === RELEASES.length });
    }
    const permission = /^\/permission\/([a-z_]+)\.pdf$/.exec(rest);
    if (method === "GET" && permission) {
      return pdf(route, letterPdf(1, true));
    }
    // The packet and the handbook: pages to draw and places to sign. Their marks are not remembered —
    // no spec walks either past its first place.
    if (method === "GET" && rest === "/packet") return pdf(route, letterPdf(PACKET_PAGES));
    if (method === "GET" && rest === "/handbook.pdf") return pdf(route, letterPdf(3));
    if (method === "POST" && rest === "/mark") return json(route, 201, { signedCount: 1, complete: false });
    if (method === "POST" && rest === "/handbook/mark") return json(route, 201, { ok: true });
    if (method === "POST" && rest === "/unlock") {
      return json(route, 200, { draft: { ...(state.bundle.draft as Json), locked: false, payload: state.draft.payload ?? {}, revision: state.draft.revision } });
    }
    if (method === "GET" && rest === "/sms-consent") {
      return json(route, 200, {
        document: { version: "v1", title: "Text messages", citation: "c", body: "b", intent: "I agree to receive texts." },
        status: { offered: true, state: "none", phoneLast4: null },
      });
    }
    if (method === "POST" && rest === "/intake") return json(route, 201, { ok: true, keptExisting: [] });
    if (method === "POST" && rest === "/intake/licences") return json(route, 201, { ok: true, keptExisting: [], licenceCount: 1 });
    if (method === "POST" && rest === "/identity") return json(route, 201, { ok: true, keptExisting: [] });
    if (method === "POST" && rest === "/screen-events") return json(route, 200, { ok: true, inserted: 0, closed: 0 });
    // Anything else the page asks for is a route this fake does not know — say so in the failure.
    state.unstubbed.push(`${method} ${rest}`);
    return json(route, 501, { error: { code: "not_stubbed", message: `e2e stub: ${method} ${rest}` } });
  });

  return {
    state,
    cut: (pattern) => void state.cutPatterns.push(pattern),
    restore: () => void (state.cutPatterns.length = 0),
    callsTo: (method, pattern) => state.calls.filter((c) => c.method === method && pattern.test(c.path)),
  };
}
