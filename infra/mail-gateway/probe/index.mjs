// The P0 probe (docs/plans/dispatch-loads/BROKER-MAIL-READER-PLAN.md §9, P0; blocker B-4).
//
// This is the code `setup.sh` puts in the gateway's Lambda BEFORE the gateway exists. It runs every
// P0 proof from the place the real gateway will run — the function's own role, on Lambda's changing
// address — because a proof run from a laptop would prove the laptop: a different AWS principal (so a
// different `sub`, V7), a different network (A11), and none of the role's own policy conditions.
// PR-c's first deploy replaces it with the real bundle; nothing here is imported by anything.
//
// What it may return is deliberately narrow, because the owner pastes the result into a chat: verdicts,
// HTTP statuses, Microsoft/Postgres error CODES, counts, and the token's non-secret claims (issuer,
// subject, audience, lifetime, whether a `roles` claim exists). Never the token, never a message, a
// subject line, an address or a body — a body that does come back under Mail.ReadBasic is reported as
// "present", which is itself the failure being looked for. GUIDs in Microsoft's error text are masked
// (they carry the tenant and client ids, which stay out of chat logs and out of the public repo).
//
// Invoke with {"mailbox": "<a test mailbox>"} (prove.sh does it). The canary comes from Parameter
// Store, so nobody can "prove" the canary by typing a mailbox that happens to be refused.

import { GetWebIdentityTokenCommand, STSClient } from "@aws-sdk/client-sts";
import { GetParametersByPathCommand, SSMClient } from "@aws-sdk/client-ssm";
import postgres from "postgres";

const GRAPH = "https://graph.microsoft.com/v1.0";
// Entra's fixed audience for a federated credential; the role's policy allows only this one (setup.sh).
const AUDIENCE = "api://AzureADTokenExchange";
// The envelope fields D-BMR6 selects — the probe asks for exactly what the gateway will ask for.
const ENVELOPE =
  "internetMessageId,conversationId,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,subject";

const mask = (s) => String(s ?? "").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>");
const claims = (jwt) => {
  const [h, p] = jwt.split(".");
  const dec = (x) => JSON.parse(Buffer.from(x, "base64url").toString("utf8"));
  return { header: dec(h), payload: dec(p) };
};

async function settings() {
  const path = process.env.MAILGW_PARAM_PATH;
  const ssm = new SSMClient({});
  const out = {};
  let NextToken;
  do {
    const r = await ssm.send(new GetParametersByPathCommand({ Path: path, WithDecryption: true, NextToken }));
    for (const p of r.Parameters ?? []) out[p.Name.slice(path.length + 1)] = p.Value;
    NextToken = r.NextToken;
  } while (NextToken);
  return out;
}

// One Graph GET. Returns status + Microsoft's error code only; the caller decides what of the body
// (counts, presence flags) may leave this function.
async function graph(token, url, extraHeaders = {}) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, ...extraHeaders } });
  let json = null;
  try { json = await res.json(); } catch { /* empty or non-JSON body */ }
  return { status: res.status, code: json?.error?.code ?? null, json };
}

export async function handler(event = {}) {
  const steps = [];
  const step = (name, ok, detail = {}) => {
    steps.push({ step: name, ok, ...detail });
    console.log(JSON.stringify({ step: name, ok })); // logs: step names and verdicts only (§6 Logs)
  };
  let cfg;
  try {
    cfg = await settings();
    const need = ["TENANT_ID", "CLIENT_ID", "CANARY_MAILBOX"];
    const missing = need.filter((k) => !cfg[k]);
    step("settings", missing.length === 0, { missing, present: Object.keys(cfg).sort() });
    if (missing.length) return { steps };
  } catch (e) {
    step("settings", false, { error: e.name });
    return { steps };
  }

  // ---- 1. AWS token (V7: RS256 asked for explicitly, regional endpoint, subject = role ARN) --------
  let awsJwt;
  try {
    // GetWebIdentityToken is served by REGIONAL endpoints only (V7), so the endpoint is pinned here
    // rather than left to the SDK's default resolution, and reported so the proof records it.
    const endpoint = `https://sts.${process.env.AWS_REGION}.amazonaws.com`;
    const sts = new STSClient({ endpoint });
    const r = await sts.send(new GetWebIdentityTokenCommand({ Audience: [AUDIENCE], SigningAlgorithm: "RS256", DurationSeconds: 300 }));
    awsJwt = r.WebIdentityToken;
    const { header, payload } = claims(awsJwt);
    step("aws_token", header.alg === "RS256", {
      endpoint,
      alg: header.alg, iss: payload.iss, sub: payload.sub, aud: payload.aud, lifetimeSeconds: payload.exp - payload.iat,
    });
  } catch (e) {
    step("aws_token", false, { error: e.name, message: mask(e.message) });
    return { steps };
  }

  // ---- 2. Exchange it at Entra for a Graph token (no secret anywhere) ---------------------------
  let graphToken;
  {
    const body = new URLSearchParams({
      client_id: cfg.CLIENT_ID,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: awsJwt,
    });
    const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(cfg.TENANT_ID)}/oauth2/v2.0/token`, { method: "POST", body });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      // AADSTS70021 = no federated credential matches (issuer/subject/audience); Entra says nothing
      // more specific, which is V7's "fails silently on a wrong subject" — compare aws_token.sub.
      step("entra_exchange", false, { status: res.status, error: json.error, codes: json.error_codes, description: mask(json.error_description?.split("\r\n")[0]) });
      return { steps };
    }
    graphToken = json.access_token;
    const { payload } = claims(graphToken);
    // V2: the plan requires NO Entra-consented Graph permission on badge 2. A `roles` claim means one
    // was consented — tenant-wide, which is exactly what the scope groups exist to prevent.
    const roles = payload.roles ?? [];
    step("entra_exchange", roles.length === 0, {
      rolesClaim: roles, audience: payload.aud, appMatches: payload.appid === cfg.CLIENT_ID || payload.azp === cfg.CLIENT_ID,
      tenantMatches: payload.tid === cfg.TENANT_ID, note: roles.length ? "Entra-consented permission present — remove it (V2)" : "no Entra-consented permission (good)",
    });
  }

  // ---- 3. Test mailbox: readable envelopes, body refused under Mail.ReadBasic -------------------
  const mb = typeof event.mailbox === "string" ? event.mailbox.trim() : "";
  if (!mb) {
    step("test_mailbox", false, { error: "no mailbox in the invoke payload" });
  } else {
    const u = `${GRAPH}/users/${encodeURIComponent(mb)}`;
    const inbox = await graph(graphToken, `${u}/mailFolders/inbox?$select=id`);
    step("test_mailbox_inbox", inbox.status === 200, { status: inbox.status, code: inbox.code });
    const folders = await graph(graphToken, `${u}/mailFolders/delta?$select=displayName`);
    step("test_mailbox_folder_delta", folders.status === 200, { status: folders.status, code: folders.code, folders: folders.json?.value?.length ?? null });
    const delta = await graph(graphToken, `${u}/mailFolders/inbox/messages/delta?changeType=created&$select=${ENVELOPE}`, { prefer: "odata.maxpagesize=5" });
    const first = delta.json?.value?.[0];
    step("test_mailbox_message_delta", delta.status === 200, {
      status: delta.status, code: delta.code, messages: delta.json?.value?.length ?? null,
      envelopeFieldsPresent: first ? ["internetMessageId", "conversationId", "from", "receivedDateTime"].filter((k) => k in first) : null,
      nextOrDeltaLink: Boolean(delta.json?.["@odata.nextLink"] || delta.json?.["@odata.deltaLink"]),
    });
    const sent = await graph(graphToken, `${u}/mailFolders/sentitems?$select=id`);
    step("test_mailbox_sent_items", sent.status === 200, { status: sent.status, code: sent.code });
    if (first?.id) {
      // Under Mail.ReadBasic the body must not come back: a refusal or a response without the body
      // passes. `expectBody: true` (days 4–7, Mail.Read) inverts it. Content is never returned.
      const b = await graph(graphToken, `${u}/messages/${encodeURIComponent(first.id)}?$select=body,bodyPreview`);
      const bodyPresent = Boolean(b.json?.body?.content || b.json?.bodyPreview);
      const expectBody = event.expectBody === true;
      step("body_reading", bodyPresent === expectBody, { status: b.status, code: b.code, bodyPresent, expectBody });
    } else {
      // A mailbox that does not exist (404) or is refused has no message to try; only an opened,
      // empty Inbox asks for a test message (2026-11-24: the first run said "empty" for a 404).
      step("body_reading", false, { error: delta.status === 200 ? "test mailbox Inbox is empty — send it one message and run again" : `no message to try: the mailbox answered ${delta.status}` });
    }
  }

  // ---- 4. Canary: must be refused. Opened = the scope is wrong (D-BMR14) ------------------------
  {
    const c = await graph(graphToken, `${GRAPH}/users/${encodeURIComponent(cfg.CANARY_MAILBOX)}/mailFolders/inbox?$select=id`);
    if (c.status === 200) console.log("CANARY_OPENED"); // the log metric filter's pattern (setup.sh)
    step("canary_refused", c.status === 403, { status: c.status, code: c.code, note: c.status === 404 ? "canary address not found — inconclusive" : undefined });
    // No directory permission either: listing users must be refused (D-BMR14 works without one).
    const d = await graph(graphToken, `${GRAPH}/users?$top=1&$select=id`);
    step("directory_refused", d.status === 403, { status: d.status, code: d.code });
  }

  // ---- 5. Database: a custom login through the Supabase pooler from Lambda (V8, A11) -----------
  const dbUrl = cfg.DATABASE_URL_PROBE ?? cfg.DATABASE_URL;
  if (!dbUrl) {
    step("database", false, { error: "no DATABASE_URL_PROBE/DATABASE_URL parameter — run db-login.sh first" });
  } else {
    const sql = postgres(dbUrl, { prepare: false, max: 1, connect_timeout: 10, idle_timeout: 1 });
    try {
      const [who] = await sql`select current_user as role, current_setting('server_version') as version`;
      let tableRefused;
      try { await sql`select 1 from public.organizations limit 1`; tableRefused = false; } catch (e) { tableRefused = e.code === "42501"; }
      step("database", tableRefused, { role: who.role, version: who.version, port: new URL(dbUrl).port, userForm: new URL(dbUrl).username.replace(/\.[a-z0-9]{20}$/, ".<project>"), tableRefused });
    } catch (e) {
      step("database", false, { error: e.code ?? e.name, message: mask(e.message) });
    } finally {
      await sql.end({ timeout: 2 }).catch(() => {});
    }
  }
  return { ok: steps.every((s) => s.ok), steps };
}
