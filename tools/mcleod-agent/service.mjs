/**
 * The parts of `--service` that decide whether it is safe to leave running unattended on the Board VM:
 * how it posts, where it may post, how it proves it is the only copy, and how it keeps its memory.
 *
 * ── WHY THEY LEFT agent.mjs (production-readiness audit, 2026-09-28) ─────────────────────────────
 * They lived inside `agent.mjs`, which runs `main()` on import, so none of them could be tested, and the
 * audit found a defect in each one:
 *  · the POST had no timeout. A hung API held a cycle for as long as the platform's fetch waited, and
 *    since the lock's heartbeat was written only BETWEEN cycles, a long enough hang made the lock look
 *    abandoned: a second copy started then would take it, and two services would read McLeod at once,
 *    which is the one thing the letter to Alex rules out ("one program, one connection");
 *  · a refused POST (401, or a 4xx for a payload the API rejects) was retried four times. `postFail`
 *    threw INSIDE the retry `try`, so the `catch` treated a refusal as a network blip;
 *  · the ingest URL was not checked, so the bearer token went wherever the config pointed, plain http
 *    included;
 *  · the state file was rewritten in place. Power lost mid-write left half a JSON document, the next
 *    start threw on it, and systemd restarted it into the same throw forever.
 * Everything here is a pure function or takes its I/O as a parameter, so `service.test.mjs` can hold
 * each one still without a server, a network or a real clock.
 */
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";

/** One POST's ceiling. The largest real payload (a 500-movement mirror batch) is well under a second. */
export const POST_TIMEOUT_MS = 60_000;
export const POST_ATTEMPTS = 4;

/**
 * A refusal we must not repeat: our token or our payload. Retrying it cannot succeed, only hide the
 * fault for another fifteen seconds and send the same bytes three more times.
 */
export class RefusedError extends Error {}

/**
 * The ingest URL, checked before the first byte leaves: an origin (`https://host`), https only. The one
 * exception is a loopback address, for a developer running the API on their own machine; nothing else
 * travels in the clear, because what travels is the bearer token.
 */
export function validateIngestUrl(raw) {
  const value = String(raw ?? "").trim().replace(/\/+$/, "");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`FUELGUARD_INGEST_URL is not a URL: "${value}". Expected e.g. https://fleetguardapi-production.up.railway.app`);
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error(`FUELGUARD_INGEST_URL must be https:// — it carries the ingest token. Got ${url.protocol}//${url.host}`);
  }
  if (url.username || url.password) throw new Error("FUELGUARD_INGEST_URL must not carry credentials; the token goes in FUELGUARD_INGEST_TOKEN.");
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`FUELGUARD_INGEST_URL must be the origin only (https://host), not ${value} — the connector adds /api/tms/… itself.`);
  }
  return url.origin;
}

/**
 * POST JSON with the ingest token. Transient failures — a timeout, a network error, a 5xx, a 429 — are
 * retried with backoff; a refusal (any other non-2xx) is thrown as `RefusedError` at once. A 3xx is a
 * refusal too: `redirect: "error"` means the token is never carried to a host we did not name.
 *
 * `fetchImpl`, `sleep` and `log` are parameters so the test can drive every branch.
 */
export async function postJson({ origin, path, token, body, fetchImpl = fetch, sleep, log = () => {}, timeoutMs = POST_TIMEOUT_MS }) {
  const url = `${origin}${path}`;
  let lastError = null;
  for (let attempt = 1; attempt <= POST_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      // Network error, TLS failure, refused redirect or our own timeout: the request may not have
      // arrived. Retry — every ingest route is keyed on McLeod's ids, so a resend is an overwrite.
      lastError = e?.name === "TimeoutError" ? `no answer within ${timeoutMs / 1000} s` : (e?.message ?? String(e));
    }
    if (res) {
      if (res.ok) return res.json().catch(() => ({}));
      if (res.status === 401) throw new RefusedError(`FuelGuard rejected the ingest token (401) on ${path}. Re-check FUELGUARD_INGEST_TOKEN.`);
      if (res.status < 500 && res.status !== 429) {
        const detail = await res.json().catch(() => null);
        // The API's 4xx body is its first validation message (tmsIngest.ts) — a field path and a rule,
        // never the data — so it is safe to log and it is the only clue to what was refused.
        throw new RefusedError(`FuelGuard ${path} refused the payload (HTTP ${res.status})${detail ? `: ${JSON.stringify(detail)}` : ""}`);
      }
      lastError = `HTTP ${res.status}`;
    }
    if (attempt < POST_ATTEMPTS) {
      const backoff = 1000 * 2 ** (attempt - 1);
      log(`POST ${path} failed (${lastError}); retrying in ${backoff} ms…`);
      await sleep(backoff);
    }
  }
  throw new Error(`FuelGuard ${path} unreachable after ${POST_ATTEMPTS} attempts: ${lastError}`);
}

// ── ONE COPY ONLY ──────────────────────────────────────────────────────────────────────────────────
//
// A lock counts as held when its process exists AND it was touched within LOCK_STALE_MS. The pid alone
// is not enough on Windows, which reuses ids after a reboot. The heartbeat is a TIMER, not a step of the
// work loop: a cycle blocked on McLeod's 15-second cap or a slow API must not let the lock go stale.

export const LOCK_STALE_MS = 2 * 60_000;
export const LOCK_HEARTBEAT_MS = 30_000;

function pidAlive(pid, kill) {
  if (!(pid > 0)) return false;
  try {
    kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

/**
 * Take the lock or throw. Returns `{ heartbeat, release }`: call `heartbeat()` on a timer, `release()`
 * on the way out. `now` and `kill` are parameters for the test; production passes neither.
 */
export function takeLock(path, { pid = process.pid, now = () => Date.now(), kill = process.kill.bind(process), log = () => {} } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx");
      writeFileSync(fd, String(pid));
      closeSync(fd);
      return {
        heartbeat() {
          // Only rewrite a lock that is still ours: if an operator removed it and another copy took it,
          // writing our pid over theirs would make two services each believe they hold it.
          try {
            if (Number(readFileSync(path, "utf8").trim()) === pid) writeFileSync(path, String(pid));
            else throw new Error("lock taken by another process");
          } catch (e) {
            throw new Error(`service lock lost (${e.message}); stopping rather than run beside another copy`);
          }
        },
        release() {
          try {
            if (Number(readFileSync(path, "utf8").trim()) === pid) unlinkSync(path);
          } catch {
            /* already gone */
          }
        },
      };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const holder = Number(readFileSync(path, "utf8").trim());
      const fresh = now() - statSync(path).mtimeMs < LOCK_STALE_MS;
      const alive = pidAlive(holder, kill);
      if (alive && fresh) throw new Error(`another connector is already running (pid ${holder}, lock ${path}). Refusing to start a second.`);
      log(`service: removing stale lock from pid ${holder} (${alive ? "not touched for over 2 minutes" : "process gone"})`);
      unlinkSync(path);
    }
  }
  throw new Error(`could not take the service lock at ${path}`);
}

// ── MEMORY BETWEEN CYCLES AND RESTARTS ─────────────────────────────────────────────────────────────
//
// Written to a temporary file, flushed, then renamed over the old one — a rename is atomic on the same
// filesystem, so a reader sees the old document or the new one, never half of one. The previous good
// copy is kept as `.bak`. A document that still will not parse (a disk fault, a hand edit) stops the
// service with the file named, rather than being silently replaced: the state holds the movement ids
// the close read still owes, and starting over would forget them.

export const EMPTY_SERVICE_STATE = Object.freeze({ runs: {}, posted: {}, mirrored: {}, board: [], dispatchersHash: null });

function parseState(text) {
  const s = JSON.parse(text);
  if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error("not a JSON object");
  return {
    runs: s.runs ?? {},
    posted: s.posted ?? {},
    mirrored: s.mirrored ?? {},
    board: Array.isArray(s.board) ? s.board : [],
    dispatchersHash: s.dispatchersHash ?? null,
  };
}

export function loadServiceState(path, { log = () => {} } = {}) {
  const bak = `${path}.bak`;
  if (!existsSync(path) && !existsSync(bak)) return structuredClone(EMPTY_SERVICE_STATE);
  const problems = [];
  for (const candidate of [path, bak]) {
    if (!existsSync(candidate)) continue;
    try {
      const state = parseState(readFileSync(candidate, "utf8"));
      if (candidate === bak) log(`service: ${path} unreadable (${problems.join("; ")}); resumed from ${bak}`);
      return state;
    } catch (e) {
      problems.push(`${candidate}: ${e.message}`);
    }
  }
  throw new Error(
    `service state cannot be read (${problems.join("; ")}). It lists the loads the close read still owes, so it is not ` +
      `replaced silently. Move it aside and run --close --ids-file with production's open McLeod loads before restarting.`,
  );
}

export function saveServiceState(path, state) {
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, "w", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(state, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (existsSync(path)) {
    try {
      renameSync(path, `${path}.bak`);
    } catch {
      /* a missing .bak is not a reason to lose the new state */
    }
  }
  renameSync(tmp, path);
}

// ── WHAT THE SERVICE REFUSES TO START WITH ─────────────────────────────────────────────────────────

/**
 * Settings that would break a condition in Alex's approval (2026-09-24), refused at start rather than
 * discovered in production:
 *  · `ROSTER_MODE=reconcile` retires every Silvicom row absent from McLeod's roster — "Part 5 stays
 *    manual", and absence is exactly the signal that retired 33 vehicles and 120 drivers on 2026-09-14.
 *  · `--dry-run` with `--service`: the service posts; a dry run must not. The old behaviour was to exit
 *    on the first POST, which looked like a crash.
 */
export function serviceConfigProblems({ rosterMode, dryRun }) {
  const problems = [];
  if (rosterMode === "reconcile") {
    problems.push("ROSTER_MODE=reconcile retires rows by absence, which must stay a manual step (Part 5). Use identity.");
  }
  if (dryRun) problems.push("--service cannot run as a dry run. Use --loads --dry-run, --close --dry-run or --roster --dry-run.");
  return problems;
}
