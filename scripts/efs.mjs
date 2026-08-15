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
 * `FG_TOKEN` is still honoured when it is already exported, because a scripted sweep needs it — but
 * nothing tells you to set it, and the prompt is the documented path. That matches how every other
 * live check in this workstream has been run: paste it once, at the keyboard.
 *
 *   pnpm efs:scan                        # prompts for the token, hidden
 *   pnpm efs:prove card_lock             # prompts for the token and the card number, both hidden
 *   pnpm efs:promote card_lock --proof <uuid> --reason "OEG green on QA"
 *   pnpm efs:promote card_lock --suspend --reason "override drift on 7670"
 *   pnpm efs:echo-scan
 *
 * `--api` overrides the host. It defaults to the API service, NOT the web service: they deploy
 * independently and only one of them can reach EFS (docs/30 §4, Step 5.10).
 */
const API_DEFAULT = "https://fleetguardapi-production.up.railway.app";

const [, , command, capability, ...rest] = process.argv;
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
 * The admin token, prompted for unless already exported.
 *
 * Resolved lazily and once per run, so a command that dies on its arguments never asks for a
 * credential it was not going to use.
 */
let cachedToken = null;
async function getToken() {
  if (cachedToken) return cachedToken;
  if (process.env.FG_TOKEN) { cachedToken = process.env.FG_TOKEN; return cachedToken; }
  console.log(
    "Copy an admin token from the browser console on the app you are signed into:\n"
      + '  copy(JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith("sb-")&&k.endsWith("-auth-token")))).access_token)\n',
  );
  const value = await promptHidden("Paste admin token (hidden): ", "admin token");
  if (!value) die("No token given.");
  cachedToken = value;
  return cachedToken;
}

async function call(path, body) {
  const bearer = await getToken();
  const res = await fetch(`${api}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
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
    await getToken();
    const card = await promptHidden("Card number (hidden): ", "card number");
    if (!/^[0-9]{12,25}$/.test(card)) die("That does not look like a card number.");
    console.log(`Proving ${capability} against \u2022\u2022\u2022\u2022${card.slice(-4)} \u2014 it will be written to twice.`);
    await call(`/api/fuel-cards/prove/${capability}`, { cardNumber: card, confirm: `PROVE ${card.slice(-4)}` });
    break;
  }

  case "promote": {
    if (!capability) die("usage: pnpm efs:promote <capability> --proof <id> --reason <why>   |   --suspend --reason <why>");
    const reason = typeof flags.reason === "string" ? flags.reason : null;
    if (!reason) die("--reason is required in both directions: 'why was this allowed' and 'why was this stopped' are both audit questions.");
    if (flags.suspend) {
      await call(`/api/fuel-cards/promote/${capability}`, { action: "suspend", reason });
      break;
    }
    if (typeof flags.proof !== "string") die("--proof <id> is required to enable. Run `pnpm efs:prove` first.");
    await call(`/api/fuel-cards/promote/${capability}`, { action: "enable", reason, proofId: flags.proof });
    break;
  }

  default:
    die("commands: scan · echo-scan · prove <capability> --card <n> · promote <capability> [--proof <id> | --suspend] --reason <why>");
}
