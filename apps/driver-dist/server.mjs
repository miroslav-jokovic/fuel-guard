#!/usr/bin/env node
/**
 * FuelGuard Driver — internal build distribution (ship-pipeline plan D1.3).
 *
 * A deliberately tiny service: it hands a signed Android APK to an invited tester over HTTPS and
 * tells them exactly which commit they are installing. CI pushes builds here; testers read from it.
 *
 * WHY ZERO DEPENDENCIES. This is an internet-facing service holding the artifact that gets installed
 * on every fleet phone. Its whole job is "store bytes, serve bytes, check two secrets" — Node's own
 * http/fs/crypto do all of that, and every dependency added here is a supply-chain path straight
 * onto a driver's device. It stays dependency-free on purpose.
 *
 * WHY NOT PUBLIC. Tester access is a shared passphrase over HTTP Basic — enough to keep an unlisted
 * URL from becoming a public download of an app that talks to production. Uploads use a separate
 * bearer token that only CI holds. Both are compared in constant time, and BOTH fail closed: with
 * the secret unset the service refuses rather than defaulting open.
 *
 * Storage is a Railway volume at DATA_DIR. Railway mounts volumes at runtime only, so CI cannot
 * build into it — CI PUTs the finished artifact here instead.
 */
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { basename, join } from "node:path";

const PORT = Number(process.env.PORT ?? 8080);
const DATA_DIR = process.env.DATA_DIR ?? "/data";
const RELEASES_DIR = join(DATA_DIR, "releases");
const INDEX_FILE = join(DATA_DIR, "releases.json");
const TESTER_PASSWORD = process.env.TESTER_PASSWORD ?? "";
const UPLOAD_TOKEN = process.env.UPLOAD_TOKEN ?? "";
const KEEP_RELEASES = Number(process.env.KEEP_RELEASES ?? 10);
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? 90);
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 300 * 1024 * 1024);

/** Constant-time compare that does not leak length through an early return. */
function secretEquals(given, expected) {
  if (!expected) return false; // fail closed when unconfigured
  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  const len = Math.max(a.length, b.length);
  const pa = Buffer.alloc(len);
  const pb = Buffer.alloc(len);
  a.copy(pa);
  b.copy(pb);
  return timingSafeEqual(pa, pb) && a.length === b.length;
}

async function readIndex() {
  try {
    return JSON.parse(await readFile(INDEX_FILE, "utf8"));
  } catch {
    return { releases: [] };
  }
}

async function writeIndex(index) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(INDEX_FILE, JSON.stringify(index, null, 2));
}

/** Newest first; the install page and /download/latest.apk both read position 0. */
function sortReleases(releases) {
  return [...releases].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

/** Retention (plan §8 open question 2): keep the last N, and nothing older than RETENTION_DAYS. */
async function prune(index) {
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  const sorted = sortReleases(index.releases);
  const keep = sorted.filter((r, i) => i < KEEP_RELEASES && Date.parse(r.uploadedAt) >= cutoff);
  const drop = sorted.filter((r) => !keep.includes(r));
  for (const release of drop) {
    await rm(join(RELEASES_DIR, release.file), { force: true });
  }
  return { releases: keep };
}

function unauthorized(res, scheme) {
  if (scheme === "basic") res.setHeader("WWW-Authenticate", 'Basic realm="FuelGuard internal builds"');
  res.writeHead(401, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "unauthorized" }));
}

/** Tester gate. Username is ignored — one shared passphrase, handed out with the install link. */
function testerAuthorized(req) {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  return secretEquals(decoded.slice(decoded.indexOf(":") + 1), TESTER_PASSWORD);
}

/** CI gate. A separate secret from the tester passphrase, so rotating one never exposes the other. */
function uploadAuthorized(req) {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") && secretEquals(header.slice(7), UPLOAD_TOKEN);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function installPage(releases) {
  const latest = releases[0];
  const rows = releases
    .slice(1)
    .map(
      (r) =>
        `<li><a href="/download/${encodeURIComponent(r.file)}">${escapeHtml(r.version)} · ${escapeHtml(r.commit ?? "")}</a> <span class="muted">${escapeHtml(r.uploadedAt.slice(0, 10))}</span></li>`,
    )
    .join("");
  const body = latest
    ? `<p class="version">Version ${escapeHtml(latest.version)}</p>
       <p class="muted">commit ${escapeHtml(latest.commit ?? "unknown")} · built ${escapeHtml(latest.uploadedAt.replace("T", " ").slice(0, 16))} UTC · ${(latest.bytes / 1048576).toFixed(1)} MB</p>
       <a class="cta" href="/download/latest.apk">Install FuelGuard Driver</a>
       ${latest.notes ? `<pre class="notes">${escapeHtml(latest.notes)}</pre>` : ""}`
    : `<p class="muted">No build has been published yet.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FuelGuard Driver — internal builds</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.55 -apple-system, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 32px 20px 64px; max-width: 34rem; margin-inline: auto; }
  h1 { font-size: 1.35rem; margin: 0 0 4px; }
  .version { font-size: 1.1rem; font-weight: 600; margin: 20px 0 2px; }
  .muted { opacity: .65; font-size: .9rem; margin: 0; }
  .cta { display: block; margin: 24px 0; padding: 16px; text-align: center; border-radius: 12px; background: #1c64f2; color: #fff; text-decoration: none; font-weight: 600; }
  .notes { white-space: pre-wrap; background: rgba(127,127,127,.12); padding: 12px; border-radius: 10px; font-size: .85rem; }
  ol, ul { padding-left: 1.2rem; } li { margin: 6px 0; }
  section { margin-top: 32px; } h2 { font-size: .95rem; text-transform: uppercase; letter-spacing: .04em; opacity: .6; }
</style></head><body>
<h1>FuelGuard Driver</h1>
<p class="muted">Internal test build — not from the Play Store.</p>
${body}
<section><h2>Installing</h2><ol>
  <li>Tap <strong>Install FuelGuard Driver</strong> above.</li>
  <li>Android will ask permission to install apps from your browser. Allow it — this is a one-time setting per device.</li>
  <li>If a "Play Protect" notice appears, choose <strong>Install anyway</strong>. It shows for any app that did not come from the Play Store.</li>
  <li>Open the app and sign in with the login your fleet manager issued you.</li>
</ol></section>
${rows ? `<section><h2>Previous builds</h2><ul>${rows}</ul></section>` : ""}
<section><h2>Reporting a problem</h2><p class="muted">Open Settings inside the app and send a screenshot of the “About this build” card. It identifies exactly which build you are on.</p></section>
</body></html>`;
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(payload));
}

async function handleUpload(req, res, url) {
  const filename = basename(decodeURIComponent(url.pathname.replace("/api/releases/", "")));
  if (!/^[A-Za-z0-9._-]+\.apk$/.test(filename)) return sendJson(res, 400, { error: "bad_filename" });

  await mkdir(RELEASES_DIR, { recursive: true });
  const target = join(RELEASES_DIR, filename);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_UPLOAD_BYTES) return sendJson(res, 413, { error: "too_large" });
    chunks.push(chunk);
  }
  if (bytes === 0) return sendJson(res, 400, { error: "empty_body" });
  await writeFile(target, Buffer.concat(chunks));

  const notesHeader = req.headers["x-release-notes"];
  const release = {
    id: randomUUID(),
    file: filename,
    version: String(req.headers["x-release-version"] ?? "unknown"),
    commit: req.headers["x-release-commit"] ? String(req.headers["x-release-commit"]).slice(0, 7) : null,
    runtimeVersion: req.headers["x-release-runtime"] ? String(req.headers["x-release-runtime"]) : null,
    // Fingerprint of the native project this APK was built from. The OTA workflow reads it back to
    // decide whether a change can ship as JavaScript or needs a new binary (ship-pipeline D2.4).
    fingerprint: req.headers["x-release-fingerprint"] ? String(req.headers["x-release-fingerprint"]) : null,
    notes: notesHeader ? Buffer.from(String(notesHeader), "base64").toString("utf8") : null,
    bytes,
    uploadedAt: new Date().toISOString(),
  };
  const index = await readIndex();
  const pruned = await prune({ releases: [release, ...index.releases.filter((r) => r.file !== filename)] });
  await writeIndex(pruned);
  return sendJson(res, 201, { ok: true, release });
}

async function serveApk(res, file) {
  const path = join(RELEASES_DIR, basename(file));
  try {
    const info = await stat(path);
    res.writeHead(200, {
      "content-type": "application/vnd.android.package-archive",
      "content-length": info.size,
      "content-disposition": `attachment; filename="${basename(file)}"`,
      "cache-control": "no-store",
    });
    createReadStream(path).pipe(res);
  } catch {
    sendJson(res, 404, { error: "not_found" });
  }
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === "/healthz") {
      return sendJson(res, 200, {
        status: TESTER_PASSWORD && UPLOAD_TOKEN ? "ok" : "misconfigured",
        service: "FuelGuard driver-dist",
      });
    }

    if (req.method === "PUT" && url.pathname.startsWith("/api/releases/")) {
      if (!uploadAuthorized(req)) return unauthorized(res, "bearer");
      return handleUpload(req, res, url);
    }

    // CI reads the release feed too — to find the fingerprint of the APK currently installed. Its
    // bearer token is accepted for reads so we do not have to hand CI the tester passphrase as well;
    // one secret per actor, and rotating either never exposes the other.
    if (!testerAuthorized(req) && !uploadAuthorized(req)) return unauthorized(res, "basic");

    const index = await readIndex();
    const releases = sortReleases(index.releases);

    if (url.pathname === "/" ) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(installPage(releases));
    }
    if (url.pathname === "/api/releases") return sendJson(res, 200, { releases });
    if (url.pathname === "/download/latest.apk") {
      if (!releases[0]) return sendJson(res, 404, { error: "no_release" });
      return serveApk(res, releases[0].file);
    }
    if (url.pathname.startsWith("/download/")) {
      return serveApk(res, url.pathname.slice("/download/".length));
    }
    return sendJson(res, 404, { error: "not_found" });
  })().catch(() => sendJson(res, 500, { error: "internal" }));
});

server.listen(PORT, () => {
  console.log(`[driver-dist] listening on :${PORT} — data ${DATA_DIR}`);
  if (!TESTER_PASSWORD || !UPLOAD_TOKEN) {
    console.error("[driver-dist] TESTER_PASSWORD and/or UPLOAD_TOKEN unset — refusing every request until they are.");
  }
});
