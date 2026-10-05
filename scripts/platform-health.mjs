#!/usr/bin/env node
/**
 * Pushes a PLATFORM alarm to the people in Settings → Alert recipients (DATA-LIFECYCLE-PLAN Q9,
 * answered 2026-10-05 by 0427 + this monitor).
 *
 * `/api/version` already publishes the two platform states no carrier's office can act on — the
 * database's own maintenance (`maintenance.state`, L6/D-LIFE10: once L7 partitions a table, a stopped
 * `pg_cron` job is an outage, not a slow leak) and schema drift — but it is a PULL surface: nobody
 * hears it. This runs from GitHub Actions, outside our API and database, on purpose: the alarm that
 * matters most says the API is down, and production would have been the thing to send it.
 *
 *   node scripts/platform-health.mjs check   # reads API_URL + STATE_FILE, may send, rewrites STATE_FILE
 *   node scripts/platform-health.mjs --self-test
 *
 * One observation per run. A problem pages only when the SAME problem is seen on two runs in a row
 * (a release legitimately shows `schema.drift` for the minutes between its migration and its deploy,
 * measured 2026-10-05: ~5 min), once per problem, and a recovery is sent only for a problem that paged.
 * State is the previous run's result, carried in STATE_FILE (the workflow keeps it in the Actions
 * cache); a missing or unreadable state is treated as "ok, nothing paged", so the worst case of a lost
 * cache is one extra 15-minute delay, never a missed alarm and never a repeat.
 *
 * Recipients, providers and fallback secrets are release-notify.mjs's, unchanged (0427).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { chooseRecipients, readTable, sendEmail, sendSms, fitSms } from "./release-notify.mjs";

const OK_MAINTENANCE = new Set(["ok", "pending"]);

/** What one `/api/version` read says, as a stable problem key ("" = healthy). Pure. */
export function classify(read) {
  if (!read.ok) return `unreachable`;
  const v = read.body ?? {};
  const m = v.maintenance?.state;
  if (m && !OK_MAINTENANCE.has(m)) return `maintenance:${m}`;
  if (v.schema?.drift === true) return `schema:${v.schema.state ?? "drift"}`;
  return "";
}

/**
 * Decide from the previous state and this observation. Pure.
 * prev: { problem, streak, paged } ; returns { next, send: null | "alert" | "recovered" }.
 */
export function decide(prev, problem) {
  const p = { problem: "", streak: 0, paged: false, ...(prev ?? {}) };
  if (!problem) {
    return { next: { problem: "", streak: 0, paged: false }, send: p.paged ? "recovered" : null };
  }
  const streak = problem === p.problem ? p.streak + 1 : 1;
  const already = problem === p.problem && p.paged;
  const page = !already && streak >= 2;
  return {
    next: { problem, streak, paged: already || page },
    send: page ? "alert" : null,
    wasPaged: p.paged ? p.problem : "",
  };
}

const WHAT = {
  unreachable: "The production API did not answer /api/version.",
  "maintenance:stale":
    "The database's scheduled maintenance has not succeeded recently (pg_cron / partman).",
  "maintenance:failing": "The database's scheduled maintenance is failing (pg_cron / partman).",
  "maintenance:inactive":
    "The database's scheduled maintenance job is inactive (pg_cron / partman).",
  "maintenance:missing": "The database's scheduled maintenance job is missing (pg_cron / partman).",
  "maintenance:unknown": "The API reports an unrecognised maintenance state.",
};

/** The message for an alert or a recovery. Pure. */
export function compose(send, problem, e) {
  const what =
    WHAT[problem] ??
    (problem.startsWith("schema:")
      ? `Production's schema does not match its code (schema.state = ${problem.slice(7)}).`
      : `Platform check: ${problem}.`);
  if (send === "recovered") {
    return {
      subject: `Recovered: production platform check is healthy again`,
      text: `The problem reported earlier (${problem}) is no longer observed at ${e.url}.\n\nRun: ${e.runUrl ?? "—"}`,
      sms: null,
    };
  }
  return {
    subject: `PRODUCTION ALERT: ${problem}`,
    text: `${what}\n\nSeen on two checks in a row, 15 minutes apart. ${e.url}/api/version${e.detail ? `\n\n${e.detail}` : ""}\n\nRun: ${e.runUrl ?? "—"}`,
    sms: fitSms(`Silvicom 360 PRODUCTION ALERT: ${problem}. ${e.runUrl ?? ""}`.trim()),
  };
}

async function readVersion(url) {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/version`, {
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok && body != null, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}

function readState(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

async function check() {
  const env = process.env;
  if (!env.API_URL) throw new Error("API_URL is not set");
  const file = env.STATE_FILE || "platform-health-state.json";
  const read = await readVersion(env.API_URL);
  const problem = classify(read);
  const prev = readState(file);
  const { next, send } = decide(prev, problem);
  writeFileSync(file, JSON.stringify(next));
  console.log(
    `observed: ${problem || "healthy"} (HTTP ${read.status}); previous: ${prev?.problem || "healthy"}; send: ${send ?? "nothing"}`,
  );
  if (!send) return;
  const subjectOf = send === "recovered" ? prev.problem : problem;
  const detail = read.body
    ? `maintenance=${read.body.maintenance?.state ?? "—"}, schema=${JSON.stringify(read.body.schema ?? null)}, commit=${read.body.commitShort ?? "—"}`
    : (read.error ?? `HTTP ${read.status}`);
  const msg = compose(send, subjectOf, { url: env.API_URL, runUrl: env.RUN_URL, detail });
  const who = chooseRecipients(await readTable(env), env);
  console.log(
    `Recipients: ${who.email.to.length} email (${who.email.source}), ${who.sms.to.length} phone (${who.sms.source}).`,
  );
  const problems = [
    await sendEmail(env, who.email.to, msg.subject, msg.text, "Silvicom 360 platform").catch(
      (e) => `email failed: ${e.message}`,
    ),
  ];
  if (msg.sms)
    problems.push(await sendSms(env, who.sms.to, msg.sms).catch((e) => `SMS failed: ${e.message}`));
  for (const p of problems.filter(Boolean)) console.log(`::warning::Platform alert: ${p}`);
  console.log(`Sent "${msg.subject}"${msg.sms ? " + SMS" : ""}.`);
}

function selfTest() {
  let fail = 0,
    n = 0;
  const eq = (name, got, want) => {
    n++;
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — got ${JSON.stringify(got)}`}`);
  };
  const v = (o) => ({
    ok: true,
    status: 200,
    body: { maintenance: { state: "ok" }, schema: { state: "current", drift: false }, ...o },
  });
  eq("a healthy read is no problem", classify(v({})), "");
  eq(
    "maintenance pending is healthy (D-LIFE10)",
    classify(v({ maintenance: { state: "pending" } })),
    "",
  );
  eq("a failed read is unreachable", classify({ ok: false, status: 0 }), "unreachable");
  eq(
    "stale maintenance is a problem",
    classify(v({ maintenance: { state: "stale" } })),
    "maintenance:stale",
  );
  eq(
    "drift is a problem, named by its state",
    classify(v({ schema: { state: "ahead", drift: true } })),
    "schema:ahead",
  );
  eq(
    "maintenance outranks drift",
    classify(v({ maintenance: { state: "failing" }, schema: { state: "ahead", drift: true } })),
    "maintenance:failing",
  );

  const one = decide(null, "schema:ahead");
  eq("one sighting does not page (a release's migrate→deploy gap)", one.send, null);
  eq("…then healthy again sends nothing", decide(one.next, "").send, null);
  const two = decide(one.next, "schema:ahead");
  eq("the same problem twice in a row pages", two.send, "alert");
  eq("…and only once while it lasts", decide(two.next, "schema:ahead").send, null);
  eq("…and a paged problem's recovery is sent", decide(two.next, "").send, "recovered");
  eq("a different problem restarts the streak", decide(two.next, "unreachable").send, null);
  eq(
    "…and pages on its own second sighting",
    decide(decide(two.next, "unreachable").next, "unreachable").send,
    "alert",
  );
  eq("a lost state cannot cause a repeat page", decide(null, "unreachable").send, null);

  const a = compose("alert", "unreachable", {
    url: "https://api.x",
    runUrl: "https://github.com/o/r/actions/runs/1",
  });
  eq("an alert pages by SMS within one segment", a.sms !== null && a.sms.length <= 160, true);
  eq(
    "a recovery is email only",
    compose("recovered", "unreachable", { url: "https://api.x" }).sms,
    null,
  );
  console.log(`\nRESULT: ${n - fail} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const cmd = process.argv[2];
  if (cmd === "--self-test") selfTest();
  else if (cmd === "check") await check();
  else {
    console.error("usage: platform-health.mjs check | --self-test");
    process.exit(2);
  }
}
