#!/usr/bin/env node
/**
 * Pages the Alert recipients when a Supabase SECRET key (`sb_secret_…`, the one that bypasses RLS) is
 * used from an address that is not ours (AWS-MIGRATION-PLAN §5, after Railway's 2026-10-21 disclosure
 * that customer environment variables were read, some decrypted).
 *
 * The key cannot be revoked tonight without taking the app down — Railway's deploys are paused, so
 * nothing can be given a new one — and Supabase has no per-key address allowlist. So the honest
 * protection until rotation is to SEE a stranger use it within minutes, and then decide to pull it.
 *
 *   node scripts/supabase-key-watch.mjs check      # one pass: reads the logs, may send, rewrites STATE_FILE
 *   node scripts/supabase-key-watch.mjs test-alert # sends a test message to the recipients
 *   node scripts/supabase-key-watch.mjs --self-test
 *
 * One pass reads the last 15 minutes of each project's API gateway log (the management API's
 * `analytics/endpoints/logs`, ClickHouse SQL over `logs`, source `edge_logs`), grouped by client
 * address. An address is OURS when it is:
 *   - Railway's network (AS400940). Only `@fleetguard/api` has static IPs; web and the console send
 *     from Railway's shared pool (measured 2026-10-21: 152.55.177.80, 152.55.178.45), so the
 *     network, not a list of addresses, is what can be trusted without paging on every redeploy;
 *   - a GitHub Actions runner (api.github.com/meta `actions`) — migrate and schema-drift call
 *     Supabase from there;
 *   - in KEYWATCH_OFFICE_IPS: our own fixed addresses — the office, and since 2026-10-22 the AWS
 *     servers' Elastic IPs (production 44.236.127.194, staging 44.239.69.109; AWS-MIGRATION-PLAN §7).
 *     The first AWS staging deploy is what paged here before they were listed.
 * Anything else pages, once per address per hour while it keeps going. The window overlaps the
 * 5-minute schedule on purpose: the gateway log lands a minute or two late.
 *
 * A watcher that cannot read the log is blind, and blind looks exactly like quiet — so three failed
 * passes in a row page too ("watcher blind"), at most every 6 hours.
 *
 * Recipients, providers and fallback secrets are release-notify.mjs's, unchanged (0427).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { chooseRecipients, readTable, sendEmail, sendSms } from "./release-notify.mjs";

const WINDOW_MIN = 15;
const REALERT_MS = 60 * 60_000;
const BLIND_AFTER = 3;
const BLIND_REPEAT_MS = 6 * 60 * 60_000;
const ORG_TTL_MS = 30 * 24 * 60 * 60_000;
const META_TTL_MS = 24 * 60 * 60_000;
export const RAILWAY_ORG = /^AS400940\b/;

/** IPv4 or IPv6 address → [version, BigInt]. Pure. */
export function parseIp(ip) {
  if (ip.includes(".") && !ip.includes(":")) {
    const p = ip.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    return [4, p.reduce((a, n) => (a << 8n) + BigInt(n), 0n)];
  }
  if (!ip.includes(":")) return null;
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = ip.includes("::") ? (tail ? tail.split(":") : []) : [];
  const groups = ip.includes("::") ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  if (groups.length !== 8) return null;
  return [6, groups.reduce((a, g) => (a << 16n) + BigInt(parseInt(g || "0", 16)), 0n)];
}

/** Is `ip` inside `cidr`? Pure. */
export function inCidr(ip, cidr) {
  const [net, bitsRaw] = cidr.split("/");
  const a = parseIp(ip);
  const n = parseIp(net);
  if (!a || !n || a[0] !== n[0]) return false;
  const width = a[0] === 4 ? 32n : 128n;
  const bits = BigInt(bitsRaw ?? width);
  const shift = width - bits;
  return a[1] >> shift === n[1] >> shift;
}

/** Why an address is ours, or null when it is not. Pure. */
export function whyOurs(ip, ctx) {
  if (ctx.office.has(ip)) return "office";
  if (RAILWAY_ORG.test(ctx.orgOf(ip) ?? "")) return "railway";
  if (ctx.actionsCidrs.some((c) => inCidr(ip, c))) return "github-actions";
  return null;
}

/**
 * Which grouped log rows page now, and the state to carry. Pure.
 * rows: [{ project, ip, ua, c, first, last, paths }]; state.alerted: { "<project> <ip>": epochMs }.
 */
export function decide(rows, ctx, state, now) {
  const alerted = { ...(state.alerted ?? {}) };
  for (const [k, t] of Object.entries(alerted)) if (now - t > 24 * REALERT_MS) delete alerted[k];
  const alerts = [];
  for (const r of rows) {
    if (!r.ip || whyOurs(r.ip, ctx)) continue;
    const key = `${r.project} ${r.ip}`;
    if (alerted[key] && now - alerted[key] < REALERT_MS) continue;
    alerted[key] = now;
    alerts.push(r);
  }
  return { alerts, state: { ...state, alerted } };
}

/** Blind-watcher bookkeeping: whether this pass pages for it. Pure. */
export function blind(state, failed, now) {
  const failures = failed ? (state.failures ?? 0) + 1 : 0;
  const page = failed && failures >= BLIND_AFTER && now - (state.blindPagedAt ?? 0) > BLIND_REPEAT_MS;
  return { page, state: { ...state, failures, ...(page ? { blindPagedAt: now } : {}) } };
}

/** The message for one stranger. Pure. */
export function message(r, org) {
  // Supabase's log API returned `timestamp` as epoch microseconds on 2026-10-21 and as zone-less ISO
  // text on 2026-10-22; the first stranger after that change crashed the pass while building this
  // message, so nothing was sent. A format change must never stop an alert going out.
  const t = (v) => {
    const d = /^\d+$/.test(String(v)) ? new Date(Math.floor(Number(v) / 1000)) : new Date(`${String(v).replace(/Z?$/, "")}Z`);
    return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(11, 16);
  };
  return (
    `SECURITY — Supabase ${r.project}: the SECRET key was used from ${r.ip} (${org || "unknown network"}), ` +
    `${r.c} requests ${t(r.first)}–${t(r.last)} UTC, e.g. ${(r.paths ?? []).slice(0, 3).join(", ")}. ` +
    `Not Railway, GitHub or the office. If this is not you: Supabase → Project settings → API keys → delete ` +
    `the secret key (the app stops until it is redeployed with a new one).`
  );
}

const SQL = `SELECT log_attributes['request.headers.cf_connecting_ip'] AS ip,
  any(log_attributes['request.headers.user_agent']) AS ua, count() AS c,
  min(timestamp) AS first, max(timestamp) AS last,
  groupUniqArray(5)(log_attributes['request.path']) AS paths
FROM logs WHERE source = 'edge_logs'
  AND startsWith(log_attributes['request.sb.apikey.apikey.prefix'], 'sb_secret')
GROUP BY ip`;

async function readLog(env, ref, now) {
  const p = new URLSearchParams({
    sql: SQL,
    iso_timestamp_start: new Date(now - WINDOW_MIN * 60_000).toISOString(),
    iso_timestamp_end: new Date(now).toISOString(),
  });
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs?${p}`, {
    headers: { authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(`log read ${ref.slice(0, 6)}…: HTTP ${res.status} ${JSON.stringify(body.error ?? "").slice(0, 160)}`);
  return body.result ?? [];
}

async function orgOf(ip, state, now) {
  const hit = state.orgs?.[ip];
  if (hit && now - hit.at < ORG_TTL_MS) return hit.org;
  try {
    const res = await fetch(`https://ipinfo.io/${ip}/org`, { signal: AbortSignal.timeout(10_000) });
    const org = res.ok ? (await res.text()).trim() : "";
    state.orgs = { ...(state.orgs ?? {}), [ip]: { org, at: now } };
    return org;
  } catch {
    return hit?.org ?? "";
  }
}

async function actionsCidrs(state, now) {
  if (state.meta && now - state.meta.at < META_TTL_MS) return state.meta.actions;
  try {
    const res = await fetch("https://api.github.com/meta", { signal: AbortSignal.timeout(15_000) });
    const actions = (await res.json()).actions;
    if (!Array.isArray(actions) || !actions.length) throw new Error("no actions ranges");
    state.meta = { at: now, actions };
    return actions;
  } catch {
    return state.meta?.actions ?? [];
  }
}

async function send(env, subject, text) {
  const who = chooseRecipients(await readTable(env), env);
  const problems = [await sendEmail(env, who.email.to, subject, text, "Silvicom 360 security"), await sendSms(env, who.sms.to, text)].filter(Boolean);
  if (env.KEYWATCH_DESKTOP === "1" && process.platform === "darwin") {
    try {
      execFileSync("osascript", ["-e", `display notification ${JSON.stringify(text.slice(0, 220))} with title "Silvicom 360 security" sound name "Sosumi"`]);
    } catch {
      // The desktop banner is a convenience on the interim Mac; email and SMS above are the alarm.
    }
  }
  for (const p of problems) console.log(`warning: ${p}`);
}

export const projects = (s) =>
  (s ?? "").split(",").map((x) => x.trim()).filter(Boolean).map((x) => { const [name, ref] = x.split("="); return { name, ref }; });

async function check() {
  const env = process.env;
  const now = Date.now();
  let state = {};
  try {
    state = JSON.parse(readFileSync(env.STATE_FILE, "utf8"));
  } catch {
    // First pass, or an unreadable file: start clean. The worst case is one repeated alert.
  }
  let rows = [];
  let failed = false;
  try {
    if (!env.SUPABASE_ACCESS_TOKEN) throw new Error("no SUPABASE_ACCESS_TOKEN");
    for (const p of projects(env.KEYWATCH_PROJECTS)) rows.push(...(await readLog(env, p.ref, now)).map((r) => ({ ...r, project: p.name })));
  } catch (e) {
    failed = true;
    console.log(`error: ${e.message}`);
  }
  const b = blind(state, failed, now);
  state = b.state;
  if (b.page) await send(env, "Silvicom 360: key watcher is blind", `SECURITY — the Supabase key watcher has failed ${state.failures} passes in a row and cannot see key use. Last error in its log on the watching machine.`);
  const office = new Set((env.KEYWATCH_OFFICE_IPS ?? "").split(",").map((x) => x.trim()).filter(Boolean));
  // Networks are looked up once per address per 30 days (cached in the state), so a pass costs a
  // lookup only for an address it has not seen before.
  const orgs = {};
  for (const r of rows) if (r.ip && !office.has(r.ip)) orgs[r.ip] = await orgOf(r.ip, state, now);
  const ctx = { office, actionsCidrs: await actionsCidrs(state, now), orgOf: (ip) => orgs[ip] };
  const d = decide(rows, ctx, state, now);
  state = d.state;
  for (const r of d.alerts) {
    const text = message(r, orgs[r.ip]);
    console.log(text);
    await send(env, `SECURITY: Supabase ${r.project} secret key used from ${r.ip}`, text);
  }
  console.log(`${new Date(now).toISOString()} pass: ${rows.length} address(es), ${d.alerts.length} alert(s)${failed ? ", READ FAILED" : ""}`);
  writeFileSync(env.STATE_FILE, JSON.stringify(state));
}

function selfTest() {
  const assert = (c, m) => { if (!c) { console.error(`FAIL: ${m}`); process.exit(1); } };
  assert(inCidr("4.242.197.254", "4.242.0.0/16"), "v4 inside");
  assert(!inCidr("4.243.0.1", "4.242.0.0/16"), "v4 outside");
  assert(inCidr("2a01:111:f403::1", "2a01:111::/32"), "v6 inside");
  assert(!inCidr("2a01:112::1", "2a01:111::/32"), "v6 outside");
  assert(!inCidr("4.242.0.1", "2a01:111::/32"), "families never match");
  assert(inCidr("209.37.91.162", "209.37.91.162/32"), "host route");
  const ctx = { office: new Set(["173.9.238.30"]), actionsCidrs: ["4.242.0.0/16"], orgOf: (ip) => (ip.startsWith("152.55.") ? "AS400940 Railway" : "AS7018 AT&T Enterprises, LLC") };
  assert(whyOurs("152.55.177.80", ctx) === "railway", "railway pool is ours");
  assert(whyOurs("4.242.197.254", ctx) === "github-actions", "runner is ours");
  assert(whyOurs("173.9.238.30", ctx) === "office", "office is ours");
  assert(whyOurs("209.37.91.162", ctx) === null, "a stranger is not ours");
  // A name that merely CONTAINS the ASN digits is not Railway.
  assert(whyOurs("1.2.3.4", { ...ctx, orgOf: () => "AS4009401 Someone" }) === null, "ASN prefix is exact");
  const rows = [
    { project: "production", ip: "152.55.177.181", c: 9, first: "1", last: "2", paths: [] },
    { project: "production", ip: "209.37.91.162", c: 3, first: "1", last: "2", paths: ["/rest/v1/drivers"] },
  ];
  const now = 10 * REALERT_MS;
  const a = decide(rows, ctx, {}, now);
  assert(a.alerts.length === 1 && a.alerts[0].ip === "209.37.91.162", "only the stranger pages");
  const b = decide(rows, ctx, a.state, now + 5 * 60_000);
  assert(b.alerts.length === 0, "no repeat within the hour");
  const c = decide(rows, ctx, b.state, now + REALERT_MS + 1);
  assert(c.alerts.length === 1, "repeats after an hour while it keeps going");
  const s = decide([{ ...rows[1], project: "staging" }], ctx, a.state, now + 60_000);
  assert(s.alerts.length === 1, "the same address on another project is its own alarm");
  // Real clock values, so "never paged before" is long ago and only the failure count can hold a page back.
  const T = Date.parse("2026-10-22T03:00:00Z");
  let st = {};
  for (let i = 1; i <= 2; i++) { const r = blind(st, true, T + i * 300_000); assert(!r.page, `no blind page on failure ${i}`); st = r.state; }
  const third = blind(st, true, T + 900_000);
  assert(third.page, "third failure in a row pages");
  assert(!blind(third.state, true, T + 1_200_000).page, "blind page is not repeated within 6 h");
  assert(blind(third.state, true, T + 900_000 + BLIND_REPEAT_MS + 1).page, "still blind after 6 h pages again");
  assert(blind(third.state, false, T + 1_500_000).state.failures === 0, "a good pass resets the count");
  assert(message(rows[1], "AS7018 AT&T").includes("209.37.91.162"), "message names the address");
  const at = (first) => message({ ...rows[1], first, last: first }, "x");
  assert(at("1792695232177000").includes("18:53–18:53"), "epoch-microsecond timestamps read");
  assert(at("2026-10-22T18:53:52.177000").includes("18:53–18:53"), "zone-less ISO timestamps read as UTC");
  assert(at("not a time").includes("not a time"), "an unknown timestamp is shown as given, never thrown");
  assert(projects("production=abc, staging=def")[1].ref === "def", "project list parses");
  console.log("supabase-key-watch self-test: OK");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv[2];
  if (arg === "--self-test") selfTest();
  else if (arg === "check") await check();
  // Proves the delivery path (recipients, Brevo, Telnyx, desktop) end to end without a stranger.
  else if (arg === "test-alert") await send(process.env, "Silvicom 360: key watcher test", "TEST — the Supabase key watcher can reach you. No action needed.");
  else { console.error("usage: supabase-key-watch.mjs check | test-alert | --self-test"); process.exit(2); }
}
