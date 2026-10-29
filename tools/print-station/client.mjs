/**
 * Talking to the Silvicom API (PRINTERS-AND-SCANNERS-PLAN.md PS3; `/api/print-station`).
 *
 * The McLeod connector's audit (tools/mcleod-agent/service.mjs, 2026-09-28) found four defects in its
 * HTTP layer and each one is designed out here from the start:
 *  · every request has a timeout — the long poll's is the server's 25 s wait plus margin;
 *  · a refusal (401, or any 4xx) is never retried — a revoked station stops and says so;
 *  · the API address is checked before the token leaves: https only, origin only (a loopback http
 *    address is allowed for a developer running the API locally);
 *  · the config file is written atomically, so a power cut mid-write cannot leave half a token.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from "node:fs";
import { dirname } from "node:path";

export const REQUEST_TIMEOUT_MS = 30_000;
/** The server holds a poll for 25 s; give it room before calling the connection dead. */
export const POLL_TIMEOUT_MS = 40_000;

/** Refused by the server: our token or our request. Retrying cannot help. */
export class RefusedError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function validateApiUrl(raw) {
  const value = String(raw ?? "").trim().replace(/\/+$/, "");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`The API address is not a URL: "${value}". Expected e.g. https://app.silvicom360.com`);
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error(`The API address must be https:// — it carries the station's token. Got ${url.protocol}//${url.host}`);
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`The API address must be the site's origin only (https://host), not ${value}.`);
  }
  return url.origin;
}

export function readConfig(path) {
  const config = JSON.parse(readFileSync(path, "utf8"));
  if (!config.apiUrl || !config.token) throw new Error(`${path} is missing apiUrl or token — pair again.`);
  return { apiUrl: validateApiUrl(config.apiUrl), token: String(config.token), stationName: config.stationName ?? "" };
}

/** Write-then-rename, so the file is always either the old config or the whole new one. */
export function writeConfig(path, config) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows ignores POSIX modes; the installer restricts the folder instead.
  }
}

/**
 * One request. Resolves `{ status, body }` for 2xx; throws `RefusedError` for 4xx (never retried) and a
 * plain Error for a 5xx, a timeout or a network fault (the caller backs off and tries again).
 * `signal` is the station's stop: it ends a long poll at once instead of when the poll would.
 */
export async function request(apiUrl, path, { method = "GET", token, body, timeoutMs = REQUEST_TIMEOUT_MS, fetchImpl = fetch, signal } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const res = await fetchImpl(`${apiUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "error",
    signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (res.status >= 400 && res.status < 500 && res.status !== 429) {
    const message = parsed?.error?.message ?? parsed?.message ?? `HTTP ${res.status}`;
    throw new RefusedError(message, res.status);
  }
  if (res.status >= 400) throw new Error(`HTTP ${res.status} from ${path}`);
  return { status: res.status, body: parsed };
}
