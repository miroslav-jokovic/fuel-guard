#!/usr/bin/env node
/**
 * `pnpm efs:<command>` — the operator-facing side of the Phase 4 harness (Step 4.6).
 *
 * Every command is one authenticated HTTP call to the API, printed as JSON. Deliberately thin: the
 * decisions live server-side, where they can be tested and where a client cannot skip them. A CLI
 * that computed anything itself would be a second implementation of the promotion rule, and the
 * second one to drift is the one nobody tests.
 *
 * ── Neither the token nor the card number is ever an argument ───────────────────────────────────
 * BOTH are prompted for, hidden, and held in memory for the life of one request. A flag lands in
 * shell history, in the process table, and in any shell integration that records commands: a bearer
 * token for an admin account has no business there, and a PAN has less. Standing rule 13 keeps card
 * numbers out of the repository; keeping them out of `~/.zsh_history` is the same rule, same secret.
 *
 * `FG_TOKEN` is read ONLY when `--token-from-env` is passed, for a scripted sweep. It is not picked
 * up implicitly: a token left exported from an earlier session would otherwise shadow the prompt
 * silently and fail as "Invalid or expired token", which reads like a vendor problem and is not one.
 *
 *   pnpm efs:scan                        # prompts for the token, hidden
 *   pnpm efs:write-check                 # the ten-proof entitlement gate; prompts: token, password, card
 *   pnpm efs:prove card_lock             # prompts: token, password (step-up), card number
 *   pnpm efs:promote card_lock --proof <uuid> --reason "OEG green on QA"
 *   pnpm efs:promote card_lock --suspend --reason "override drift on 7670"
 *   pnpm efs:echo-scan
 *
 * `--api` overrides the host. It defaults to the API service, NOT the web service: they deploy
 * independently and only one of them can reach EFS (docs/30 §4, Step 5.10).
 */
const API_DEFAULT = "https://fleetguardapi-production.up.railway.app";

/**
 * `capability` is positional and OPTIONAL, so it cannot be destructured out of argv blindly.
 *
 * It used to be, and the first flag of any command that takes no capability was silently eaten as
 * the capability. `echo-scan --limit 100 --offset 50` parsed as capability="--limit", rest=["100",
 * "--offset","50"] — so `--offset` was honoured, `--limit` was dropped, and the run used the default
 * 50. It reported a completely successful scan of the wrong page size and nothing anywhere said so.
 * Same for `--api` on `scan`, which meant the host override was ignored exactly when someone was
 * pointing the tool at a second deploy on purpose.
 */
const [, , command, ...argv] = process.argv;
const capability = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
const rest = capability ? argv.slice(1) : argv;
const flags = {};
for (let i = 0; i < rest.length; i += 1) {
  if (!rest[i].startsWith("--")) continue;
  const key = rest[i].slice(2);
  const next = rest[i + 1];
  flags[key] = next && !next.startsWith("--") ? next : true;
}

const api = flags.api ?? process.env.FG_API ?? API_DEFAULT;

function die(message) {
  console.error(message);
  process.exit(1);
}

/** Read a line from the terminal without echoing it. Never falls back to an echoing read: a silent
 *  downgrade would print a PAN to the screen and into any terminal scrollback capture. */
function promptHidden(prompt, what = "value") {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      die(`No terminal available to prompt for the ${what}. Run this in an interactive shell — this never falls back to an echoing read.`);
    }
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value.trim());
          return;
        }
        if (ch === "\u0003") { process.stdout.write("\n"); process.exit(130); }
        if (ch === "\u007f") { value = value.slice(0, -1); continue; }
        value += ch;
      }
    };
    process.stdin.on("data", onData);
  });
}

/**
 * The admin token, always prompted for unless `--token-from-env` is passed.
 *
 * Resolved lazily and once per run, so a command that dies on its arguments never asks for a
 * credential it was not going to use.
 */
let cachedToken = null;
async function getToken() {
  if (cachedToken) return cachedToken;
  // ONLY with an explicit flag. Honouring FG_TOKEN whenever it happened to be set meant a stale
  // export silently shadowed the prompt: the run never asked for a token, used the old one, and
  // failed with "Invalid or expired token" — pointing at the vendor rather than at the shell. A
  // convenience that changes behaviour invisibly is not a convenience.
  if (flags["token-from-env"]) {
    if (!process.env.FG_TOKEN) die("--token-from-env was passed but FG_TOKEN is not set.");
    cachedToken = process.env.FG_TOKEN;
    return cachedToken;
  }
  console.log(
    "Copy an admin token from the browser console on the app you are signed into:\n"
      + '  copy(JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith("sb-")&&k.endsWith("-auth-token")))).access_token)\n',
  );
  const value = await promptHidden("Paste admin token (hidden): ", "admin token");
  if (!value) die("No token given.");
  cachedToken = value;
  return cachedToken;
}

/**
 * A step-up token, exchanged for a freshly typed password (`POST /api/auth/step-up`).
 *
 * `requireFreshAuth` will not accept a recent `iat`: a refresh grant can mint a new access token
 * without anyone re-entering a password, so access-token freshness is not password proof (audit
 * P0-4). The routes that write to a real card demand the step-up token specifically, which is why
 * the first two proof attempts were refused with `step_up_required`.
 *
 * The password is prompted hidden, sent once to this deploy's own API over TLS, and never stored,
 * logged, echoed or kept after the request. Supabase's password grant is the verifier and its
 * session is discarded server-side; what comes back is a short-lived HMAC token bound to user+org.
 */
let cachedStepUp = null;
async function getStepUpToken() {
  if (cachedStepUp) return cachedStepUp;
  const bearer = await getToken();
  const password = await promptHidden("Password (hidden, for step-up re-authentication): ", "password");
  if (!password) die("No password given — this action requires step-up re-authentication.");

  const res = await fetch(`${api}/api/auth/step-up`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ password }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(text);
    die("Step-up refused. The password must be the one for the account whose token you pasted.");
  }
  cachedStepUp = JSON.parse(text).token;
  if (!cachedStepUp) die("The step-up endpoint returned no token.");
  return cachedStepUp;
}

async function call(path, body, opts = {}) {
  const bearer = await getToken();
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` };
  // Only where the route demands it, and asked for BEFORE the request rather than after a 403, so
  // the operator types one password instead of discovering they needed it.
  if (opts.stepUp) headers["x-step-up-token"] = await getStepUpToken();

  const res = await fetch(`${api}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  if (res.status === 401) {
    console.error(
      "\nThe API rejected that token. It is a Supabase access token and they are short-lived —\n"
        + "copy a fresh one from the browser console of the org you mean to act on.",
    );
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  console.log(JSON.stringify(parsed, null, 2));
  // A refusal is not a crash — `promotion_refused` is the system working — but the exit code must
  // still be non-zero so a script that chains these stops rather than continuing on a "no".
  if (!res.ok) process.exit(2);
}

switch (command) {
  case "scan":
    await call("/api/fuel-cards/config-scan", {});
    break;

  case "echo-scan":
    await call("/api/fuel-cards/echo-scan", { limit: Number(flags.limit ?? 50), offset: Number(flags.offset ?? 0) });
    break;

  case "prove": {
    if (!capability) die("usage: pnpm efs:prove <capability>   (the card number is prompted for)");
    if (flags.card) {
      die(
        "--card is refused on purpose: a card number passed as a flag lands in shell history and the\n"
          + "process table. Run `pnpm efs:prove " + capability + "` and paste it at the prompt instead.",
      );
    }
    // The FULL number, because the API unseals and matches on it. Prompted, hidden, held in memory
    // for one request, and only its last four are ever printed or stored.
    await getStepUpToken();
    const card = await promptHidden("Card number (hidden): ", "card number");
    if (!/^[0-9]{12,25}$/.test(card)) die("That does not look like a card number.");
    console.log(`Proving ${capability} against \u2022\u2022\u2022\u2022${card.slice(-4)} \u2014 it will be written to twice.`);
    await call(`/api/fuel-cards/prove/${capability}`, { cardNumber: card, confirm: `PROVE ${card.slice(-4)}` }, { stepUp: true });
    break;
  }

  /**
   * The entitlement probe — the ten-proof gate in routes/fuelCards/writeProbe.ts.
   *
   * It is here because Step 2.6 needs a re-probe and there was no safe way to run one. The route
   * takes the full PAN in its body, so the alternative was a curl, and a curl puts the card number
   * in argv — the process table and the shell history — which is the one thing this CLI exists to
   * prevent. Same prompt discipline as `prove`.
   *
   * ── Why the write half is the DEFAULT here, and read-only needs a flag ──────────────────────────
   * This inverts the HTTP endpoint, whose default is `readOnly: true`, and the inversion is
   * deliberate. `writeProbe.ts` upserts `write_entitlement` UNCONDITIONALLY from the run's verdict,
   * and a read-only run can never return `confirmed` — it did not attempt a write. So running the
   * read-only diagnostic against an org that already HAS a confirmed entitlement silently downgrades
   * it to `unknown`, and every card action in that org stops until somebody runs the full ten-step
   * probe against a disposable card. A diagnostic that revokes the thing it is diagnosing is a trap,
   * and defaulting to it in an operator tool is how somebody falls into it at speed.
   *
   * The underlying behaviour is filed as its own step; this flag only stops the CLI being the way it
   * bites. `--read-only` still does the honest first run for an org that has nothing to lose.
   */
  case "write-check": {
    if (flags.card) {
      die(
        "--card is refused on purpose: a card number passed as a flag lands in shell history and the\n"
          + "process table. Run `node scripts/efs.mjs write-check` and paste it at the prompt instead.",
      );
    }
    const readOnly = flags["read-only"] === true;
    if (readOnly) {
      console.log(
        "\nREAD-ONLY run. It proves the echo against real vendor XML and touches no card.\n"
          + "It also OVERWRITES write_entitlement with `unknown`, because a run that attempted no\n"
          + "write cannot confirm one. If this org is already `confirmed`, that revokes card control\n"
          + "until a full run restores it. Check first:  node scripts/card-control-binding-check.mjs\n",
      );
    }
    await getStepUpToken();
    const card = await promptHidden("Card number (hidden): ", "card number");
    if (!/^[0-9]{10,25}$/.test(card)) die("That does not look like a card number.");
    const last4 = card.slice(-4);
    if (!readOnly) {
      console.log(
        `\nFULL run against ••••${last4}. It will set the card to `
          + `${flags.status ?? "Hold"} and revert it.\nRun this only against a card WEX has confirmed is disposable.\n`,
      );
    }
    await call(
      "/api/fuel-cards/write-check",
      {
        cardNumber: card,
        // The endpoint demands this typed string for the write half specifically, so that the
        // destructive path cannot be reached by a replayed request or a stray double-click.
        confirm: `WRITE ${last4}`,
        readOnly,
        ...(typeof flags.status === "string" ? { realChangeStatus: flags.status } : {}),
      },
      { stepUp: true },
    );
    break;
  }

  case "promote": {
    if (!capability) die("usage: pnpm efs:promote <capability> --proof <id> --reason <why>   |   --suspend --reason <why>");
    const reason = typeof flags.reason === "string" ? flags.reason : null;
    if (!reason) die("--reason is required in both directions: 'why was this allowed' and 'why was this stopped' are both audit questions.");
    if (flags.suspend) {
      await call(`/api/fuel-cards/promote/${capability}`, { action: "suspend", reason }, { stepUp: true });
      break;
    }
    if (typeof flags.proof !== "string") die("--proof <id> is required to enable. Run `pnpm efs:prove` first.");
    await call(`/api/fuel-cards/promote/${capability}`, { action: "enable", reason, proofId: flags.proof }, { stepUp: true });
    break;
  }

  default:
    die(
      "commands: scan · echo-scan · write-check [--read-only] [--status Hold|Inactive] · "
        + "prove <capability> · promote <capability> [--proof <id> | --suspend] --reason <why>\n"
        + "(card numbers and tokens are always prompted for, never passed as flags)",
    );
}
