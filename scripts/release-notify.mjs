#!/usr/bin/env node
/**
 * The release train's one summary message (RELEASE-TRAIN-PLAN D-REL6 step 7, Q-REL4).
 *
 * Q-REL4 answered 2026-10-05: the owner approves; every outcome is an EMAIL to the owners, and a
 * failure or a rollback is ALSO a text message, because a release that broke at 01:10 must wake
 * somebody before the 07:00 office does. The 18:00 release PR is an email too: an unapproved PR ships
 * nothing, and a PR nobody was told about is approved by nobody.
 *
 * Sent from the workflow, straight to Brevo and Telnyx — deliberately NOT through our API's
 * sendEmail/sendSms. The message that matters most says "production is broken", and production is
 * the thing it would have had to go through. The providers and sender are production's own
 * (MAIL_FROM, TELNYX_FROM); the recipients are repository secrets so no address is ever in the repo.
 *
 *   node scripts/release-notify.mjs <kind>       # sends; kind and details from the environment
 *   node scripts/release-notify.mjs outcome      # which kind a finished release run warrants
 *   node scripts/release-notify.mjs --self-test
 *
 * Kinds: candidate · shipped · skipped · failed · rolled-back · rollback-failed · rollback
 *
 * Environment: TAG, SHA, BEFORE, MODE, REASON, DETAIL, RUN_URL, PR_URL, NOTES_FILE, PR_COUNT;
 * secrets BREVO_API_KEY, MAIL_FROM, RELEASE_NOTIFY_EMAILS, TELNYX_API_KEY, TELNYX_FROM,
 * RELEASE_NOTIFY_PHONES (comma-separated). A missing provider or recipient is a workflow WARNING, not
 * a failure: a release must never fail because its summary could not be sent, and GitHub still emails
 * the repository owner about any failed run.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const short = (sha) => (sha ? sha.slice(0, 7) : "—");
/** SMS segments are 160 GSM characters; a release alert must fit one, link included. */
const SMS_MAX = 160;

/**
 * The message for one outcome. `sms` is null when the outcome does not page anybody. Pure.
 * `e` carries the environment's fields with lowercase names.
 */
export function compose(kind, e) {
  const name = e.tag || short(e.sha);
  const notes = e.notes ? `\n\n${e.notes}` : "";
  const run = e.runUrl ? `\n\nRun: ${e.runUrl}` : "";
  switch (kind) {
    case "candidate":
      return {
        subject: `Release ready for your approval — main @ ${short(e.sha)}${e.prCount ? ` (${e.prCount} PRs)` : ""}`,
        text:
          `Tonight's release is waiting for your approval. Approve the pull request before 01:07 CT and it ships then; ` +
          `without an approval nothing ships and the work rides the next night's train.\n\nApprove: ${e.prUrl ?? "—"}\n\n` +
          `Check it on staging first: staging serves main within minutes of every merge.${notes}`,
        sms: null,
      };
    case "shipped":
      return {
        subject: `Released ${name} to production${e.mode === "hotfix" ? " (hotfix)" : ""}`,
        text: `${name} is live on production (${short(e.sha)}), verified and smoke-tested.${e.reason ? `\n\nReason: ${e.reason}` : ""}${notes}${run}`,
        sms: null,
      };
    case "skipped":
      return { subject: `No release tonight — ${e.detail ?? "nothing approved"}`, text: `${e.detail ?? "Nothing shipped."} Production stays on ${short(e.before)}.${run}`, sms: null };
    case "failed":
      return {
        subject: `⚠ Release FAILED — production is on ${short(e.before)}${e.detail ? ` (${e.detail})` : ""}`,
        text:
          `The ${e.mode ?? "nightly"} release of ${name} failed${e.detail ? ` at: ${e.detail}` : ""}. ` +
          `Production still serves ${short(e.before)}, or the release commit if the failure came after the deploy — the run says which. ` +
          `Migrations, if any ran, stay applied (D-REL9).${run}`,
        sms: `Silvicom 360: release ${name} FAILED${e.detail ? ` (${e.detail})` : ""}. Check: ${e.runUrl ?? "GitHub Actions"}`,
      };
    case "rolled-back":
      return {
        subject: `⚠ Release ${name} rolled back automatically — production back on ${short(e.before)}`,
        text:
          `${name} (${short(e.sha)}) deployed but failed ${e.detail ?? "its post-deploy checks"}, so production was moved back to ${short(e.before)} ` +
          `and verified there. Migrations stay applied (D-REL9); the previous code runs on the new schema, which every migration is written to survive. ` +
          `The work is still on main; fix it and it rides the next approved release.${run}`,
        sms: `Silvicom 360: release ${name} failed checks and was ROLLED BACK to ${short(e.before)}. Details: ${e.runUrl ?? "GitHub Actions"}`,
      };
    case "rollback-failed":
      return {
        subject: `🚨 Release ${name} failed AND its automatic rollback failed — act now`,
        text:
          `${name} (${short(e.sha)}) failed ${e.detail ?? "its post-deploy checks"}, and moving production back to ${short(e.before)} did not verify. ` +
          `Production may be serving broken code. Run the Release workflow with mode=rollback and the previous tag, or roll back the Railway deploy by hand.${run}`,
        sms: `Silvicom 360 URGENT: release ${name} broke AND auto-rollback failed. Act now: ${e.runUrl ?? "GitHub Actions"}`,
      };
    case "rollback":
      return {
        subject: `Production rolled back to ${name}`,
        text: `Production was rolled back to ${name} (${short(e.sha)}) by hand${e.reason ? `: ${e.reason}` : ""}. Migrations were not reversed (D-REL9).${run}`,
        sms: null,
      };
    default:
      throw new Error(`unknown kind "${kind}"`);
  }
}

/**
 * Which message a finished release.yml run warrants, from its jobs' results. Pure.
 * Returns { kind, detail }; kind "" means a silent skip (a retry's skip, "already at", not a release
 * night) — one summary a night, not one per run. Order matters: a rollback outranks the failure
 * that caused it, and a failure before the push is told apart from one after it, because "production
 * unchanged" and "production on the new code" are different mornings.
 */
export function outcomeOf(r) {
  const fail = (detail) => ({ kind: "failed", detail });
  if (r.plan !== "success") return fail("planning the release");
  if (r.shipDecided !== "true") return { kind: r.notifySkip === "true" ? "skipped" : "", detail: "" };
  if (r.rollback === "success") {
    const what = r.verify === "failure" ? "deploy verification" : "the production smoke test";
    return { kind: r.verifyRollback === "success" ? "rolled-back" : "rollback-failed", detail: what };
  }
  if (r.rollback === "failure") return { kind: "rollback-failed", detail: "moving production back" };
  if (r.ship !== "success") return fail("before the deploy (CI, backup, migrations or the push) — production unchanged");
  if (r.verify !== "success") return fail("deploy verification");
  if (r.smoke !== "success") return fail("the production smoke test");
  if (r.publish !== "success") return fail("tagging and publishing (production IS on the release)");
  return { kind: r.mode === "rollback" ? "rollback" : "shipped", detail: "" };
}

/** Fits a text message into one segment, keeping the link at the end whole. Pure. */
export function fitSms(text) {
  if (text.length <= SMS_MAX) return text;
  const link = /\s(https?:\/\/\S+)$/.exec(text)?.[1] ?? "";
  const room = SMS_MAX - link.length - (link ? 2 : 1);
  return `${text.slice(0, room).trimEnd()}…${link ? ` ${link}` : ""}`;
}

/** "a@x, b@y" → ["a@x", "b@y"]. Pure. */
export const list = (s) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);

async function sendEmail(env, subject, text) {
  const to = list(env.RELEASE_NOTIFY_EMAILS);
  if (!env.BREVO_API_KEY || !env.MAIL_FROM || !to.length) return "email not configured (BREVO_API_KEY, MAIL_FROM, RELEASE_NOTIFY_EMAILS)";
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { email: env.MAIL_FROM, name: "Silvicom 360 releases" }, to: to.map((email) => ({ email })), subject, textContent: text }),
    signal: AbortSignal.timeout(15_000),
  });
  return res.ok ? null : `email refused: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`;
}

async function sendSms(env, text) {
  const to = list(env.RELEASE_NOTIFY_PHONES);
  if (!env.TELNYX_API_KEY || !env.TELNYX_FROM || !to.length) return "SMS not configured (TELNYX_API_KEY, TELNYX_FROM, RELEASE_NOTIFY_PHONES)";
  const errors = [];
  for (const phone of to) {
    const res = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: { authorization: `Bearer ${env.TELNYX_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.TELNYX_FROM, to: phone, text: fitSms(text) }),
      signal: AbortSignal.timeout(15_000),
    });
    // The number is masked in the log: a workflow log is readable by anyone with repository access.
    if (!res.ok) errors.push(`SMS to …${phone.slice(-4)} refused: HTTP ${res.status}`);
  }
  return errors.length ? errors.join("; ") : null;
}

async function main(kind) {
  const env = process.env;
  let notes = "";
  if (env.NOTES_FILE) try { notes = readFileSync(env.NOTES_FILE, "utf8").trim(); } catch { /* notes are an extra; the outcome still goes out */ }
  const msg = compose(kind, {
    tag: env.TAG, sha: env.SHA, before: env.BEFORE, mode: env.MODE, reason: env.REASON, detail: env.DETAIL,
    runUrl: env.RUN_URL, prUrl: env.PR_URL, prCount: env.PR_COUNT, notes,
  });
  const problems = [await sendEmail(env, msg.subject, msg.text).catch((e) => `email failed: ${e.message}`)];
  if (msg.sms) problems.push(await sendSms(env, msg.sms).catch((e) => `SMS failed: ${e.message}`));
  for (const p of problems.filter(Boolean)) console.log(`::warning::Release summary: ${p}`);
  console.log(`Sent "${msg.subject}"${msg.sms ? " + SMS" : ""}${problems.some(Boolean) ? " (with warnings above)" : ""}.`);
}

function selfTest() {
  let fail = 0, n = 0;
  const eq = (name, got, want) => {
    n++;
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — got ${JSON.stringify(got)}`}`);
  };
  const base = { tag: "v2026.10.06", sha: "a".repeat(40), before: "b".repeat(40), runUrl: "https://github.com/o/r/actions/runs/123", prUrl: "https://github.com/o/r/pull/9" };
  const kinds = ["candidate", "shipped", "skipped", "failed", "rolled-back", "rollback-failed", "rollback"];
  eq("only a failure or a rollback pages anybody",
    kinds.filter((k) => compose(k, base).sms !== null), ["failed", "rolled-back", "rollback-failed"]);
  eq("every paging text fits one SMS segment",
    kinds.map((k) => compose(k, { ...base, detail: "the production smoke test after the deploy, twice" }).sms).filter(Boolean).map((t) => fitSms(t).length <= 160), [true, true, true]);
  eq("a cut text keeps its link whole",
    fitSms(`${"x".repeat(200)} https://github.com/o/r/actions/runs/123`).endsWith(" https://github.com/o/r/actions/runs/123"), true);
  eq("a short text is untouched", fitSms("short https://x.y/z"), "short https://x.y/z");
  // 160 is the GSM-7 single-segment limit, written out here so the constant cannot grade itself.
  eq("a long text is cut to exactly one 160-character segment", fitSms(`${"x".repeat(300)} https://x.y/z`).length, 160);
  eq("the approval email links the PR and names the deadline",
    [compose("candidate", base).text.includes(base.prUrl), compose("candidate", base).text.includes("01:07 CT")], [true, true]);
  eq("a failure names what production is on", compose("failed", base).subject.includes("bbbbbbb"), true);
  eq("a shipped release is named by its tag", compose("shipped", base).subject, "Released v2026.10.06 to production");
  eq("…and by its commit when there is no tag", compose("shipped", { ...base, tag: "" }).subject, "Released aaaaaaa to production");
  eq("the notes ride in the email", compose("shipped", { ...base, notes: "**Fuel:**\n- #1 X" }).text.includes("- #1 X"), true);
  const ok = { plan: "success", shipDecided: "true", mode: "nightly", ship: "success", verify: "success", smoke: "success", publish: "success", rollback: "skipped", verifyRollback: "skipped" };
  const k = (r) => outcomeOf({ ...ok, ...r }).kind;
  eq("a clean run shipped", k({}), "shipped");
  eq("a manual rollback that verified is a rollback", k({ mode: "rollback" }), "rollback");
  eq("an unapproved first run tells the owners", k({ shipDecided: "false", notifySkip: "true" }), "skipped");
  eq("a retry's or an 'already at' skip is silent", k({ shipDecided: "false", notifySkip: "" }), "");
  eq("a broken plan is a failure", k({ plan: "failure", shipDecided: "" }), "failed");
  eq("a failure before the push says production is unchanged",
    outcomeOf({ ...ok, ship: "failure", verify: "skipped", smoke: "skipped", publish: "skipped" }).detail.includes("unchanged"), true);
  eq("a verify failure that rolled back and verified is rolled-back",
    outcomeOf({ ...ok, verify: "failure", smoke: "skipped", publish: "skipped", rollback: "success", verifyRollback: "success" }),
    { kind: "rolled-back", detail: "deploy verification" });
  eq("a smoke failure names the smoke test",
    outcomeOf({ ...ok, smoke: "failure", publish: "skipped", rollback: "success", verifyRollback: "success" }).detail, "the production smoke test");
  eq("a rollback that did not verify pages as rollback-failed", k({ verify: "failure", rollback: "success", verifyRollback: "failure" }), "rollback-failed");
  eq("a rollback push that failed pages as rollback-failed", k({ verify: "failure", rollback: "failure" }), "rollback-failed");
  eq("a tagging failure is a failure that says production IS on the release",
    outcomeOf({ ...ok, publish: "failure" }).detail.includes("IS on the release"), true);
  eq("recipients are a comma list, blanks dropped", list(" a@x.com, ,b@y.com "), ["a@x.com", "b@y.com"]);
  let threw = false;
  try { compose("nonsense", base); } catch { threw = true; }
  eq("an unknown kind is refused, never sent blank", threw, true);
  console.log(`\nRESULT: ${n - fail} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [cmd] = process.argv.slice(2);
  if (cmd === "--self-test") selfTest();
  else if (cmd === "outcome") {
    // release.yml's notify job: the jobs' results in, `kind=` and `detail=` lines out (GITHUB_OUTPUT).
    const e = process.env;
    const o = outcomeOf({ plan: e.PLAN, shipDecided: e.SHIP_DECIDED, notifySkip: e.NOTIFY_SKIP, mode: e.MODE, ship: e.SHIP,
      verify: e.VERIFY, smoke: e.SMOKE, publish: e.PUBLISH, rollback: e.ROLLBACK, verifyRollback: e.VERIFY_ROLLBACK });
    console.log(`kind=${o.kind}\ndetail=${o.detail}`);
  } else if (cmd) await main(cmd);
  else {
    console.error("usage: release-notify.mjs <candidate|shipped|skipped|failed|rolled-back|rollback-failed|rollback> | --self-test");
    process.exit(2);
  }
}
