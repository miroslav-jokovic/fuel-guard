#!/usr/bin/env node
// Office chat load test (OFFICE-CHAT-PLAN CH3b, §3 design target) — STAGING ONLY.
//
// What it measures, against the real 0513 trigger and `realtime.messages` policy:
//   A. one 300-member channel: every member subscribed to `chat:conv:<channel>` (and to its own
//      `chat:user:<me>`, as a real tab is); messages posted through `chat_send`, the API's own write
//      path, with its ledger row. Delivery = signal received − the moment before the send was issued.
//   B. one 50-member group: the largest conversation that still announces on each member's own topic
//      (0513's ≤ 50 rule), so the per-user fan-out is measured where it is biggest.
//   C. a sample of members answering each signal the way `chatRealtime.ts` does — `/sync?since_rev=` on
//      the uat API — so the price of "signals, never content" (one extra round trip) is measured too.
// Plus the database's CPU over each phase, from the project's Prometheus endpoint.
//
// FOOTPRINT. Everything lives in its own organisation ("Load test — office chat"), so no real staging
// user sees 300 strangers in their people picker. The test users are deleted at the end (`teardown`,
// also runnable alone after a crash: the state file holds their ids, never their passwords — those are
// random, held in memory, and reset by a re-run of `setup`). The org, its conversations and its
// ledger stay: `chat_ledger` is WORM (0511) and refuses deletion by design.
//
// Run with STAGING's api settings in the environment and the staging API's address — the values are
// in Parameter Store under /silvicom/staging/api (AWS-MIGRATION-PLAN D-AWS7), never on this machine:
//   eval "$(aws ssm get-parameters-by-path --region us-west-2 --path /silvicom/staging/api --with-decryption \
//     --query "Parameters[?ends_with(Name,'/SUPABASE_URL')||ends_with(Name,'/SUPABASE_SERVICE_ROLE_KEY')||ends_with(Name,'/VITE_SUPABASE_ANON_KEY')].[Name,Value]" \
//     --output text | awk -F'\t' '{sub(".*/","",$1); printf "export %s=%s\n", $1, $2}')"
//   node scripts/chat-load-test.mjs all --api https://staging-api.360.silvicominc.com --state <scratch>/chat-load.json
// (While Railway still serves staging, `railway run -s "@fleetguard/api" -e uat -- node …` with
// `--api https://fleetguardapi-uat.up.railway.app` is the same thing.) The API's address is never
// assumed: `--api`, else API_URL / VITE_API_URL from the environment, else a refusal.
// Commands: setup | run | teardown | all. Options: --clients 300 --messages 40 --sync-sample 20.

import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const STAGING_REF = "dssmxlddtyimrwwuqwqq";
const ORG_NAME = "Load test — office chat (CH3b)";
const EMAIL = (i) => `chat-load-${String(i).padStart(3, "0")}@loadtest.silvicom.invalid`;

const args = process.argv.slice(2);
const command = args[0] ?? "all";
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const CLIENTS = Number(opt("clients", 300));
const MESSAGES = Number(opt("messages", 40));
const SYNC_SAMPLE = Number(opt("sync-sample", 20));
const GROUP_SIZE = 50;
const STATE = opt("state", null);
const API = opt("api", process.env.API_URL ?? process.env.VITE_API_URL ?? null);
if (!API) {
  console.error("needs --api <staging API address> (or API_URL / VITE_API_URL in the environment) — the host is not assumed");
  process.exit(2);
}

const URL_ = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
if (!URL_?.includes(STAGING_REF)) {
  console.error(`refusing: SUPABASE_URL is not the staging project (${STAGING_REF})`);
  process.exit(2);
}
if (!SERVICE || !ANON || !STATE) {
  console.error("needs SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_ANON_KEY and --state <file>");
  process.exit(2);
}

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const must = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
};
const readState = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {});
const writeState = (s) => writeFileSync(STATE, JSON.stringify(s, null, 2), { mode: 0o600 });

// ── setup ─────────────────────────────────────────────────────────────────────────────────────────

async function setup() {
  const state = readState();
  if (!state.org_id) {
    const org = must(await admin.from("organizations").insert({ name: ORG_NAME }).select("id").single(), "org");
    state.org_id = org.id;
    must(await admin.from("org_modules").insert({ org_id: org.id, module_key: "messages" }), "module");
    writeState(state);
  }
  state.users ??= [];
  const passwords = new Map();
  for (let i = 0; i < CLIENTS; i++) {
    const password = randomBytes(18).toString("base64url");
    passwords.set(i, password);
    if (state.users[i]) {
      must(await admin.auth.admin.updateUserById(state.users[i], { password }), `reset ${i}`);
      continue;
    }
    const u = must(
      await admin.auth.admin.createUser({ email: EMAIL(i), password, email_confirm: true, user_metadata: { full_name: `Load ${i}` } }),
      `user ${i}`,
    );
    state.users[i] = u.user.id;
    must(await admin.from("memberships").insert({ org_id: state.org_id, user_id: u.user.id, role: "dispatcher" }), `member ${i}`);
    if (i % 50 === 49) {
      writeState(state);
      console.log(`  users ${i + 1}/${CLIENTS}`);
    }
  }
  writeState(state);

  // Keyed on team_id, not channel_id: a state file from before CH5a holds the channel this script once
  // inserted straight into message_threads — a channel with no team, which 0518's channel-shape rule
  // now refuses and which made the first staging run of 0518 fail (2026-10-24). The run uses the team's
  // General channel instead: a group stops at 250 (0512), a team does not, and chat_team_create writes
  // every member's participant row and ledger row the way the product does.
  if (!state.team_id) {
    const teamId = randomUUID();
    const generalId = randomUUID();
    must(await admin.rpc("chat_team_create", {
      p_org: state.org_id, p_actor: state.users[0], p_space_id: teamId, p_general_id: generalId,
      p_name: "Load test team", p_description: null, p_members: state.users.slice(1, CLIENTS),
    }), "team");
    state.team_id = teamId;
    state.channel_id = generalId;
    writeState(state);
  }
  if (!state.group_id) {
    const id = must(await admin.rpc("chat_create_group", {
      p_org: state.org_id, p_actor: state.users[0], p_thread_id: randomUUID(), p_subject: "Load test group",
      p_members: state.users.slice(1, GROUP_SIZE),
    }), "group");
    state.group_id = id;
    writeState(state);
  }
  console.log(`setup: org ${state.org_id}, ${state.users.length} users, channel ${state.channel_id}, group ${state.group_id}`);
  return { state, passwords };
}

// ── run ───────────────────────────────────────────────────────────────────────────────────────────

/** Sign in, honouring Auth's per-IP limit on the token endpoint by backing off on 429. */
async function signIn(i, password) {
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  for (let attempt = 0; attempt < 12; attempt++) {
    const { data, error } = await c.auth.signInWithPassword({ email: EMAIL(i), password });
    if (!error) return { client: c, token: data.session.access_token };
    if (error.status !== 429) throw new Error(`sign in ${i}: ${error.message}`);
    await sleep(30_000);
  }
  throw new Error(`sign in ${i}: still rate limited`);
}

/** Join refusals seen before a channel came up, by reason — the cost of a cold Realtime tenant. */
const joinRefusals = new Map();

/**
 * Join as a real tab does: a refused join is retried by realtime-js itself, so wait through refusals
 * and count them instead of failing. The first run on 2026-10-23 hit `MissingPartition` on every join
 * of an idle staging project — Realtime makes the daily `realtime.messages` partitions only while the
 * project's Realtime service runs, so the first connection after an idle spell races their creation.
 */
function subscribe(client, topic, onSignal, deadlineMs = 120_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${topic}: not subscribed after ${deadlineMs / 1000} s`)), deadlineMs);
    const ch = client
      .channel(topic, { config: { private: true } })
      .on("broadcast", { event: "chat" }, (m) => onSignal(m.payload, performance.now()))
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          resolve(ch);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          const why = `${status} ${(err?.message ?? "").split(":")[0]}`.trim();
          joinRefusals.set(why, (joinRefusals.get(why) ?? 0) + 1);
        }
      });
  });
}

async function cpuSample() {
  try {
    const res = await fetch(`${URL_}/customer/v1/privileged/metrics`, {
      headers: { Authorization: `Basic ${Buffer.from(`service_role:${SERVICE}`).toString("base64")}` },
    });
    if (!res.ok) return null;
    let idle = 0, total = 0;
    for (const line of (await res.text()).split("\n")) {
      const m = line.match(/^node_cpu_seconds_total\{[^}]*mode="(\w+)"[^}]*\}\s+([\d.e+]+)/);
      if (!m) continue;
      total += Number(m[2]);
      if (m[1] === "idle" || m[1] === "iowait") idle += Number(m[2]);
    }
    return total > 0 ? { idle, total } : null;
  } catch {
    return null;
  }
}
/** The script's own event-loop delay, sampled every 100 ms — the error bar on every latency it reports. */
function startLagSampler() {
  const lags = [];
  let last = performance.now();
  const t = setInterval(() => {
    const now = performance.now();
    lags.push(Math.max(0, now - last - 100));
    last = now;
  }, 100);
  return { stop: () => (clearInterval(t), { p95: pct(lags, 95), max: pct(lags, 100) }) };
}

const cpuBetween = (a, b) => (a && b && b.total > a.total ? 1 - (b.idle - a.idle) / (b.total - a.total) : null);

const pct = (xs, p) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]);
};

async function phase(label, { state, sender, threadId, members, topicOf, sample, signalsPerMember }) {
  const sentAt = new Map(); // seq → ms
  const latencies = [];
  const syncLatencies = [];
  let received = 0, syncFailed = 0;
  const unmatched = [];
  for (const m of members) {
    m.handlers[label] = (payload, at, via) => {
      if (payload?.thread_id !== threadId) return;
      received++;
      const t0 = sentAt.get(payload.seq);
      if (t0 === undefined) unmatched.push(payload.seq);
      else latencies.push(at - t0);
      // As `chatRealtime.ts` does: only the conversation's own signal syncs it; the person's own topic
      // refreshes their inbox. The first run synced on both and doubled the group's /sync load.
      if (sample.has(m.i) && via === "conv") {
        const since = Math.max(0, payload.rev - 1);
        fetch(`${API}/api/chat/${threadId}/sync?since_rev=${since}`, { headers: { Authorization: `Bearer ${m.token}` } })
          .then((r) => (r.ok ? syncLatencies.push(performance.now() - at) : syncFailed++))
          .catch(() => syncFailed++);
      }
    };
  }
  // The send time is registered under the seq the message WILL get, before the call: only this
  // script writes here, so it is last_seq + 1. Registering it after the reply (the first run) lost 446
  // group signals that arrived before the reply was processed.
  const thread = must(await admin.from("message_threads").select("last_seq").eq("org_id", state.org_id).eq("id", threadId).single(), "last_seq");
  let nextSeq = Number(thread.last_seq) + 1;
  const lag = startLagSampler();
  const before = await cpuSample();
  const started = performance.now();
  for (let k = 0; k < MESSAGES; k++) {
    sentAt.set(nextSeq, performance.now());
    const rows = must(await admin.rpc("chat_send", {
      p_org: state.org_id, p_actor: sender, p_thread: threadId, p_message_id: randomUUID(), p_body: `${label} ${k}`,
    }), `send ${label} ${k}`);
    if (Number(rows[0].seq) !== nextSeq) throw new Error(`${label}: expected seq ${nextSeq}, got ${rows[0].seq}`);
    nextSeq++;
    await sleep(1_500);
  }
  await sleep(5_000); // the stragglers
  const after = await cpuSample();
  const harnessLag = lag.stop();
  for (const m of members) delete m.handlers[label];
  const expected = MESSAGES * members.length * signalsPerMember;
  return {
    phase: label,
    topic: topicOf,
    members: members.length,
    messages: MESSAGES,
    deliveries_expected: expected,
    deliveries_received: received,
    missed: expected - received,
    unmatched: unmatched.length,
    p50_ms: pct(latencies, 50),
    p95_ms: pct(latencies, 95),
    p99_ms: pct(latencies, 99),
    max_ms: pct(latencies, 100),
    sync_sample: sample.size,
    sync_p50_ms: pct(syncLatencies, 50),
    sync_p95_ms: pct(syncLatencies, 95),
    sync_failed: syncFailed,
    // Whole-machine CPU, including staging's own schedulers — not chat's share (pg_stat_statements is).
    db_cpu: cpuBetween(before, after),
    // This script's own event-loop delay: when it is high, its latencies include its own queueing.
    harness_lag_p95_ms: harnessLag.p95,
    harness_lag_max_ms: harnessLag.max,
    seconds: Math.round((performance.now() - started) / 1000),
  };
}

async function run(state, passwords) {
  console.log(`signing in ${CLIENTS} clients (Auth rate limit may pause this)…`);
  const members = [];
  for (let i = 0; i < CLIENTS; i++) {
    const { client, token } = await signIn(i, passwords.get(i));
    await client.realtime.setAuth(token);
    members.push({ i, client, token, handlers: {} });
    if (i % 50 === 49) console.log(`  signed in ${i + 1}`);
  }
  const idle = await cpuSample();
  await sleep(10_000);
  const idleAfter = await cpuSample();

  console.log("subscribing…");
  const joinStart = performance.now();
  const dispatch = (m, via) => (payload, at) => { for (const h of Object.values(m.handlers)) h(payload, at, via); };
  await Promise.all(members.map(async (m) => {
    await subscribe(m.client, `chat:user:${state.users[m.i]}`, dispatch(m, "user"));
    await subscribe(m.client, `chat:conv:${state.channel_id}`, dispatch(m, "conv"));
    if (m.i < GROUP_SIZE) await subscribe(m.client, `chat:conv:${state.group_id}`, dispatch(m, "conv"));
  }));
  const joinSeconds = Math.round((performance.now() - joinStart) / 1000);
  console.log(`  ${members.length} clients subscribed in ${joinSeconds} s`);

  const sample = new Set(Array.from({ length: SYNC_SAMPLE }, (_, k) => 1 + k));
  const results = [];
  results.push(await phase("channel", {
    state, sender: state.users[0], threadId: state.channel_id, members, topicOf: "chat:conv (no per-user: > 50)", sample,
    signalsPerMember: 1,
  }));
  // The group's members hear each message twice — their conversation topic and their own — which is
  // exactly what a real tab with the group open would receive.
  results.push(await phase("group", {
    state, sender: state.users[0], threadId: state.group_id, members: members.slice(0, GROUP_SIZE),
    topicOf: "chat:conv + chat:user", sample: new Set([...sample].filter((i) => i < GROUP_SIZE)),
    signalsPerMember: 2,
  }));

  for (const m of members) await m.client.removeAllChannels();
  const summary = {
    when: new Date().toISOString(),
    clients: CLIENTS,
    subscribe_seconds: joinSeconds,
    join_refusals_before_subscribed: Object.fromEntries(joinRefusals),
    db_cpu_idle: cpuBetween(idle, idleAfter),
    results,
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

// ── teardown ──────────────────────────────────────────────────────────────────────────────────────

async function teardown() {
  const state = readState();
  let deleted = 0, banned = 0;
  const failed = [];
  for (const id of state.users ?? []) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (!error) { deleted++; continue; }
    // The sender of a message cannot be deleted: `messages.sender_user_id` is ON DELETE SET NULL and
    // 0511 refuses to change a message's author. Banned, the account can never sign in again.
    const ban = await admin.auth.admin.updateUserById(id, { ban_duration: "876000h" });
    if (ban.error) failed.push(`${id}: ${error.message}; ban: ${ban.error.message}`);
    else banned++;
  }
  console.log(`teardown: ${deleted} users deleted, ${banned} banned${failed.length ? `, ${failed.length} failed — first: ${failed[0]}` : ""}`);
  if (failed.length === 0) writeState({ ...state, deleted, banned, torn_down_at: new Date().toISOString() });
}

if (command === "setup") await setup();
else if (command === "teardown") await teardown();
else if (command === "run" || command === "all") {
  const { state, passwords } = await setup();
  try {
    await run(state, passwords);
  } finally {
    if (command === "all") await teardown();
  }
} else {
  console.error(`unknown command ${command}`);
  process.exit(2);
}
process.exit(0);
