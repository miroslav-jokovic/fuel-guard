#!/usr/bin/env node
/**
 * `pnpm efs:<command>` — the operator-facing side of the Phase 4 harness (Step 4.6).
 *
 * Every command is one authenticated HTTP call to the API, printed as JSON. Deliberately thin: the
 * decisions live server-side, where they can be tested and where a client cannot skip them. A CLI
 * that computed anything itself would be a second implementation of the promotion rule, and the
 * second one to drift is the one nobody tests.
 *
 * The token is READ FROM THE ENVIRONMENT and never from a flag: an argument lands in shell history
 * and in the process table, where a bearer token for an admin account has no business being.
 *
 *   export FG_TOKEN="$(pbpaste)"        # copied from the browser console
 *   pnpm efs:scan
 *   pnpm efs:prove card_lock --card 7677
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
const token = process.env.FG_TOKEN;

function die(message) {
  console.error(message);
  process.exit(1);
}

if (!token) {
  die(
    "FG_TOKEN is not set.\n\n"
      + "In the browser console on the app, run:\n"
      + '  copy(JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith("sb-")&&k.endsWith("-auth-token")))).access_token)\n\n'
      + 'then:  export FG_TOKEN="$(pbpaste)"\n\n'
      + "It is read from the environment on purpose — a token passed as a flag lands in shell history.",
  );
}

async function call(path, body) {
  const res = await fetch(`${api}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
    if (!capability) die("usage: pnpm efs:prove <capability> --card <full-card-number>");
    // The FULL number, because the API unseals and matches on it — and it is never printed back.
    const card = flags.card;
    if (typeof card !== "string") die("--card requires the full card number (it is never logged or stored).");
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
