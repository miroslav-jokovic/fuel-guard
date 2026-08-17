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
 *   node scripts/efs.mjs inventory       # the ACCOUNT inventory (Step 7.2); --cards <uuid,uuid>
 *
 * ── ⚠ Use `--out <path>`, NOT `> path` ─────────────────────────────────────────────────────────
 * The shell truncates a redirect target when it builds the pipeline — before this process starts,
 * so before `--expect-org` can refuse and before a single byte is read from the vendor. On
 * 2026-08-17 that emptied the 220 KB production inventory during a run the guard correctly
 * REFUSED, while printing "no file was written". Only git had the contents.
 *
 * `--out` opens the file here, after the org check passes, which is the only arrangement in which
 * a refusal genuinely leaves the previous capture alone:
 *
 *   node scripts/efs.mjs inventory --expect-org production --out docs/efs/account-inventory-production.json
 *   node scripts/efs.mjs sync            # force a card-mirror sweep now
 *   node scripts/efs.mjs job efs_card_sync   # watch it
 *   pnpm efs:write-check                 # the ten-proof entitlement gate; prompts: token, password, card
 *   pnpm efs:prove card_lock             # prompts: token, password (step-up), card number
 *   pnpm efs:promote card_lock --proof <uuid> --reason "OEG green on QA"
 *   pnpm efs:promote card_lock --suspend --reason "override drift on 7670"
 *   pnpm efs:echo-scan
 *
 * `--api` overrides the host. It defaults to the API service, NOT the web service: they deploy
 * independently and only one of them can reach EFS (docs/30 §4, Step 5.10).
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

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
    // STDERR, not stdout. A prompt on stdout is swallowed by `> file.json`, so the command
    // sits waiting on stdin for a token it appeared never to ask for — which is exactly how
    // `inventory > docs/efs/...json` read as hung for five minutes on 2026-08-16.
    process.stderr.write(prompt);
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
  console.error(
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

/**
 * The same request as `call`, but RETURNING the outcome instead of printing and exiting.
 *
 * `call` is right for a one-shot command: print the JSON, exit non-zero on a refusal. A drill has to
 * keep going after a refusal — the refusal IS the result, and there is state to restore afterwards.
 * Sharing the transport rather than reimplementing it keeps the auth handling in one place.
 */
async function callRaw(path, body, opts = {}) {
  const bearer = await getToken();
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` };
  if (opts.stepUp) headers["x-step-up-token"] = await getStepUpToken();
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  const res = await fetch(`${api}${path}`, { method: "POST", headers, body: JSON.stringify(body ?? {}) });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  return { ok: res.ok, status: res.status, body: parsed };
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
  const rendered = JSON.stringify(parsed, null, 2);
  if (typeof flags.out === "string") writeFileSync(flags.out, `${rendered}\n`);
  else console.log(rendered);
  // A refusal is not a crash — `promotion_refused` is the system working — but the exit code must
  // still be non-zero so a script that chains these stops rather than continuing on a "no".
  if (!res.ok) process.exit(2);
}

/**
 * Which org does this token belong to? Resolved from the SERVER, never from intent.
 *
 * ── Why every account-wide command announces this before it acts ────────────────────────────────
 * `docs/22` H10: a suspension drill was "told to use a QA token and was given a PRODUCTION one.
 * Nothing checked." On 2026-08-16 the same shape recurred harmlessly — a run intended for production
 * used a QA token, read QA, and returned output identical to the previous QA scan. Nothing in the
 * transcript said which account had been read, so the only way to tell was decoding the JWT by hand.
 *
 * A token carries its org in its own payload, but this asks the SERVER: a token is a claim, and the
 * question is which account the API will actually act on with it.
 */
const KNOWN_ORGS = {
  "07fe4058-cc72-4a69-b3e9-29b4cf1c6a44": "QA / sandbox",
};

async function resolveOrg(bearer) {
  const probe = await fetch(`${api}/api/jobs/latest?kind=efs_card_sync`, {
    headers: { Authorization: `Bearer ${bearer}` },
  }).catch(() => null);
  if (!probe?.ok) return null;
  const body = await probe.json().catch(() => null);
  return body?.latest?.org_id ?? body?.lastDone?.org_id ?? null;
}

/**
 * Say which account is about to be read — and REFUSE when it is not the one asked for.
 *
 * ── Announcing is not enough, and 2026-08-16 proved it twice in one sitting ──────────────────────
 * The banner was added after a run intended for production silently read QA. With the banner in
 * place the very next attempt did it AGAIN: three commands, three QA tokens, and the second one
 * redirected into a file named `account-inventory-production.json`. A banner tells you afterwards;
 * it cannot stop a wrong-org artefact being written under a right-org name, and a mislabelled
 * inventory is worse than a missing one — it becomes the record.
 *
 * `--expect-org` is the same guard `suspend-drill` already carries, for the same reason: "a tool
 * must confirm WHICH COMPANY it is about to act on, and must refuse rather than assume when it
 * cannot tell." Accepts `qa`, `production`, or a literal uuid.
 */
async function announceOrg(label) {
  // Validated first: a malformed flag must not cost a token prompt and a round trip to find out.
  if (flags["expect-org"] === true) die("--expect-org needs a value: qa, production, or an org uuid.");
  const org = await resolveOrg(await getToken());
  const named = org
    ? (KNOWN_ORGS[org] ? `${org}  (${KNOWN_ORGS[org]})` : `${org}  (NOT the known QA org — treat as production)`)
    : "(could not determine)";
  console.error(`\n${label} — org ${named}. Read-only: nothing is dispatched.\n`);

  const expected = flags["expect-org"];
  if (expected === undefined) return org;
  if (!org) die("--expect-org was given but this token's org could not be resolved — refusing rather than assuming.");

  const isQa = KNOWN_ORGS[org] !== undefined;
  const want = String(expected).toLowerCase();
  const ok = want === "qa" ? isQa : want === "production" ? !isQa : want === org.toLowerCase();
  if (!ok) {
    /**
     * ⚠ "No file was written" was a LIE whenever the caller used `> file.json`, and it cost the
     * 220 KB production inventory on 2026-08-17.
     *
     * The shell truncates a redirect target when it builds the pipeline — BEFORE this process
     * starts, let alone before this check runs. So the guard added to stop a wrong-org artefact
     * being written under a right-org name instead stood over a right-org file it had just emptied,
     * announcing that nothing had been written. Only git had the contents.
     *
     * Two fixes, and both are needed. `--out` (below) lets this tool open the file ITSELF, after
     * the check, which is the only arrangement where the sentence can be true. And when stdout is
     * redirected anyway, say what actually happened instead of reassuring the operator.
     */
    const redirected = !process.stdout.isTTY;
    die(
      `--expect-org ${expected}, but this token belongs to ${named}.\n`
        + "Refusing. Nothing was read from the vendor.\n"
        + (redirected
          ? "\n⚠ Your shell truncated the redirect target when it built the pipeline — BEFORE this\n"
            + "  refusal, and before anything was read. If it held a previous capture, that capture is\n"
            + "  gone from the working tree. Restore it:\n\n"
            + "      git restore <the file you redirected into>\n\n"
            + "  Then re-run with --out <path> instead of `>`, which opens the file only after this\n"
            + "  check passes.\n"
          : "No file was written.\n"),
    );
  }
  return org;
}

switch (command) {
  case "scan":
    // Announce first. This command's output is nearly identical between the two orgs, so a run
    // against the wrong one is invisible in the result — see resolveOrg.
    await announceOrg("Config scan");
    await call("/api/fuel-cards/config-scan", {});
    break;

  /**
   * The ACCOUNT inventory (Step 7.2), and the command Step 7.6 is run with.
   *
   * READ-ONLY, every one of its thirteen operations, which is why it needs no probe flag and is safe
   * against the production org — the same posture as `echo-scan` and the linking sweep. It is the
   * heaviest READ in the product: up to 28 paced calls for the account walk, and three more per card
   * named in `--cards`.
   *
   * ── It exists because the endpoint had no caller ─────────────────────────────────────────────
   * Step 7.2 built the route and nothing in the browser or this CLI could reach it. A component, a
   * hook and an endpoint with no caller is the shape the Phase 6.7 audit spent a day closing, and
   * `POST /:id/refresh` had sat unreachable since the read routes were written. Building an operator
   * surface for an operator endpoint is the fix, not a follow-up.
   *
   * ── Cards are UUIDs, never card numbers ─────────────────────────────────────────────────────
   * `--cards <uuid,uuid>` takes `efs_cards.id`. The route resolves the PAN itself, org-scoped, so no
   * card number reaches a shell history, a process table or an access log. Standing rule 13, and the
   * same reason `prove` prompts for a card number instead of taking a flag.
   *
   * Redirect it to a file to produce the artefact Step 7.6 commits:
   *   node scripts/efs.mjs inventory > docs/efs/account-inventory-production.json
   */
  case "inventory": {
    const cards = typeof flags.cards === "string"
      ? flags.cards.split(",").map((c) => c.trim()).filter(Boolean)
      : [];
    if (cards.some((c) => /^[0-9]{8,}$/.test(c))) {
      die("--cards takes efs_cards UUIDs, never card numbers. Rule 13: no PAN in a shell argument.");
    }
    await announceOrg("Account inventory");
    await call("/api/fuel-cards/account-inventory", cards.length > 0 ? { sampleCards: cards } : {});
    break;
  }

  /**
   * Echo fidelity across the whole account, paged to the end (Phase 2 / Phase 4 exit gate).
   *
   * READ-ONLY by construction: it reads each card, builds the zero-edit request it WOULD send, and
   * runs `assertEchoFidelity` against the vendor's own XML. `setCardV2` is not imported by that
   * module and `echoScan.test.ts` asserts it. Nothing is dispatched.
   *
   * ── Why it pages itself now ─────────────────────────────────────────────────────────────────────
   * The route takes at most 100 cards and one wall-clock budget per call, so a 197-card account is
   * four calls. Chasing `nextOffset` by hand meant four token pastes and four chances to fumble an
   * offset — the 2026-08-14 run was done exactly that way. A gate nobody wants to re-run is a gate
   * that goes stale, which is how "green 197/197" became a claim two days old.
   *
   * ── It names the company it scanned ─────────────────────────────────────────────────────────────
   * The gate says "green on PRODUCTION". A scan that cannot say which account it read is not evidence
   * for that sentence, and after the suspension drill pointed at the wrong org (docs/22 H10) the cost
   * of assuming is no longer theoretical. The org is resolved from the SERVER, not from intent.
   */
  case "echo-scan": {
    const bearerForOrg = await getToken();
    const probe = await fetch(`${api}/api/jobs/latest?kind=efs_card_sync`, {
      headers: { Authorization: `Bearer ${bearerForOrg}` },
    });
    const probeBody = probe.ok ? await probe.json() : null;
    const org = probeBody?.latest?.org_id ?? probeBody?.lastDone?.org_id ?? "(could not determine)";
    console.error(`\nEcho scan — org ${org}. Read-only: nothing is dispatched.\n`);

    const limit = Number(flags.limit ?? 50);
    let offset = Number(flags.offset ?? 0);
    let scanned = 0;
    let passed = 0;
    const failures = [];
    let total = null;

    /**
     * ── One transient socket error must not discard the whole sweep ─────────────────────────────
     * The first paged run died at offset 163 of 197 with an ECONNRESET — a network failure, not an
     * application one — and took 163 cards of completed work with it. The ROUTE is resumable by
     * design (it reports `nextOffset` precisely so a sweep can continue), and the loop was throwing
     * that property away by letting `fetch` reject straight out of the process.
     *
     * Retries are per BATCH, not per scan: a batch is idempotent (it reads and judges, it never
     * writes), so re-running one costs vendor budget and nothing else. On final failure the resume
     * offset is printed, because the alternative is starting a four-minute paced sweep from zero.
     */
    const attemptBatch = async (attempt = 1) => {
      try {
        return await callRaw("/api/fuel-cards/echo-scan", { limit, offset });
      } catch (error) {
        if (attempt >= 3) throw error;
        const waitMs = attempt * 3000;
        console.error(`    (network error: ${error?.cause?.code ?? error?.message ?? error} — retrying in ${waitMs / 1000}s)`);
        await new Promise((r) => setTimeout(r, waitMs));
        return attemptBatch(attempt + 1);
      }
    };

    for (let batch = 1; ; batch += 1) {
      let res;
      try {
        res = await attemptBatch();
      } catch (error) {
        console.error(`\n✗ Batch ${batch} at offset ${offset} could not be completed: ${error?.cause?.code ?? error?.message ?? error}`);
        console.error(`  ${scanned} card(s) scanned so far, ${passed} passed, ${failures.length} failed.`);
        die(`  Resume with:\n    node scripts/efs.mjs echo-scan --offset ${offset}`);
      }
      if (!res.ok) {
        console.error(JSON.stringify(res.body, null, 2));
        console.error(`  Resume with: node scripts/efs.mjs echo-scan --offset ${offset}`);
        die(`Batch ${batch} at offset ${offset} was refused — the account was NOT fully scanned.`);
      }
      const b = res.body;
      total = b.total ?? total;
      scanned += b.scanned ?? 0;
      passed += b.passed ?? 0;
      for (const r of b.results ?? []) if (!r.ok) failures.push(r);
      console.error(
        `  batch ${batch}: offset ${String(b.offset).padStart(3)}  scanned ${String(b.scanned).padStart(3)}`
          + `  passed ${String(b.passed).padStart(3)}  failed ${b.failed}   (total ${b.total})`,
      );
      if (b.nextOffset === null || b.nextOffset === undefined) break;
      offset = b.nextOffset;
    }

    console.error(`\n=== echo scan complete — org ${org} ===`);
    console.error(`  the account returns : ${total}`);
    console.error(`  scanned            : ${scanned}`);
    console.error(`  passed             : ${passed}`);
    console.error(`  failed             : ${failures.length}`);
    if (failures.length > 0) {
      console.error("\n  FAILURES — each is a card whose own document we cannot reproduce faithfully:");
      for (const f of failures) console.error(`    ••••${f.last4}: ${JSON.stringify(f.diff ?? f.error ?? f)}`);
      process.exit(2);
    }
    // Says what it covered, not just that it was green: a pass over a SHORT list is the failure mode
    // this line exists to make visible.
    console.error(
      scanned === total
        ? `\n✓ every card the account returns round-trips byte-for-byte (${scanned}/${total}).`
        : `\n⚠ scanned ${scanned} of ${total} — the sweep did NOT cover the whole account.`,
    );
    break;
  }

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
    console.error(`Proving ${capability} against \u2022\u2022\u2022\u2022${card.slice(-4)} \u2014 it will be written to twice.`);
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
   * This inverts the HTTP endpoint, whose default is `readOnly: true`. It was introduced to defuse a
   * trap — `writeProbe.ts` upserted `write_entitlement` unconditionally, so the harmless-looking
   * read-only run silently downgraded an already-`confirmed` org to `unknown` and stopped every card
   * action in it. **Step 2.7 fixed that at the source: a read-only run no longer touches the column
   * in either direction.**
   *
   * The inversion is KEPT anyway, for a reason that outlives the bug. Someone reaching for this
   * command wants the question "may this account write?" answered, and only the full run answers it;
   * a read-only run answers "would our echo have been faithful?", which is a different and rarer
   * question. Defaulting to the run that cannot answer the likely question is how an operator
   * concludes "still unproven" and goes looking for a WEX problem that does not exist.
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
      // Step 2.7 removed the hazard this warning used to carry: a read-only run no longer touches
      // `write_entitlement` at all, so it can no longer revoke an org's card control. It still
      // refreshes the credential identity binding, which is the reason to run one.
      console.error(
        "\nREAD-ONLY run. It proves the echo against real vendor XML, refreshes the credential\n"
          + "identity binding, and touches no card. It does NOT change write_entitlement in either\n"
          + "direction — a run that attempted no write has no standing to.\n",
      );
    }
    await getStepUpToken();
    const card = await promptHidden("Card number (hidden): ", "card number");
    if (!/^[0-9]{10,25}$/.test(card)) die("That does not look like a card number.");
    const last4 = card.slice(-4);
    if (!readOnly) {
      console.error(
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

  /**
   * Force a card-mirror sweep now, instead of waiting for the scheduler.
   *
   * There is deliberately no "Refresh from EFS" button in the product — card views refresh
   * themselves (audit B6) — and the scheduler's interval defaults to 24 hours. So after a change to
   * the mirror or the linker, the only way to see the new behaviour against real vendor data is to
   * ask for a sweep, and until now that meant hand-rolling a curl with an admin token in it.
   *
   * Read-only against the vendor: it lists the account's cards and re-reads details. It writes only
   * to our own mirror, and it is idempotent by construction — every write is an upsert keyed on
   * `(org_id, card_ref_hmac)`, so running it twice produces the same rows.
   *
   * The org is decided by the TOKEN, not by a flag. There is no `--org`, deliberately: an operator
   * who pastes a QA token gets a QA sweep, and one who pastes production gets production, with no
   * second place for the two to disagree.
   */
  case "sync": {
    console.error(
      "\nQueues a full card-mirror refresh for the org your token belongs to.\n"
        + "Reads the vendor's card list and details; writes only to our mirror; safe to repeat.\n",
    );
    await call("/api/fuel-cards/sync", {});
    console.error(
      "\nQueued. The sweep runs server-side — watch it with:\n"
        + "  node scripts/efs.mjs job efs_card_sync\n",
    );
    break;
  }

  /** The latest job of a kind, plus the last one that finished — how a sweep is watched. */
  case "job": {
    const kind = capability ?? "efs_card_sync";
    const bearer = await getToken();
    const res = await fetch(`${api}/api/jobs/latest?kind=${encodeURIComponent(kind)}`, {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    console.log(JSON.stringify(parsed, null, 2));
    if (!res.ok) process.exit(2);
    break;
  }

  /**
   * Does suspension actually stop a live write, and how fast? (Phase 4 exit gate)
   *
   * The gate has no cache — `promotionBlock` reads `efs_capability_promotions` on every write, and
   * that is a deliberate design decision with its own comment. So the EXPECTED propagation is "the
   * next call". Expectation is not measurement, which is why this exists: it suspends, immediately
   * attempts a real capability write, and reports the interval between the two HTTP responses.
   *
   * ── Why it cannot lock the card, whichever way the test comes out ───────────────────────────────
   * The lock body carries a DELIBERATELY STALE `expectedVersion`. Two outcomes, both harmless:
   *
   *   suspension propagated  → refused at the gate, `card_control_suspended`, before any vendor call
   *   suspension did NOT     → refused by optimistic concurrency in the plan phase, and `assertUnmoved`
   *                            sends nothing
   *
   * So a failed drill is as safe as a passing one, and the refusal CODE is what distinguishes them.
   * A drill that could damage the thing it tests would not get run twice.
   *
   * ── It always puts the capability back ──────────────────────────────────────────────────────────
   * The re-enable runs in a `finally`. Leaving a QA capability suspended would block every later
   * proof run, and the person who would discover that is not the person who ran this.
   */
  case "suspend-drill": {
    const cardId = flags.card;
    const proofId = flags.proof;
    const expectOrg = flags["expect-org"];
    if (!cardId || !proofId || !expectOrg) {
      die(
        "usage: node scripts/efs.mjs suspend-drill --card <efs_card uuid> --proof <proof uuid> "
          + "--expect-org <org uuid or prefix>",
      );
    }
    const capabilityKey = capability ?? "card_lock";

    /**
     * ── The guard this drill shipped without, and paid for immediately (2026-08-15) ───────────────
     * The first run was told "use a QA token" and was given a PRODUCTION one. Nothing checked, so it
     * suspended `card_lock` on the production org — the one org where card control had never been
     * promoted at all — and then could not restore it, because production has no proof to cite.
     *
     * The drill's safety was designed entirely around the CARD (a stale version, so no write can
     * land) and not at all around the ORG. A tool that mutates promotion state must confirm WHICH
     * COMPANY it is about to mutate, and must refuse rather than assume when it cannot tell.
     *
     * The org is read from the caller's own token via an org-scoped endpoint, so it reflects what the
     * SERVER thinks the token is, not what the operator believes it is — those two differing is the
     * entire failure being prevented.
     */
    const bearerForOrg = await getToken();
    const orgProbe = await fetch(`${api}/api/jobs/latest?kind=efs_card_sync`, {
      headers: { Authorization: `Bearer ${bearerForOrg}` },
    });
    if (!orgProbe.ok) die("Could not determine which org this token belongs to — refusing to suspend anything.");
    const probeBody = await orgProbe.json();
    const actualOrg = probeBody?.latest?.org_id ?? probeBody?.lastDone?.org_id ?? null;
    if (!actualOrg) {
      die(
        "This token's org could not be determined (no card-sync job has ever run for it). "
          + "Refusing to suspend a capability for an org I cannot name.",
      );
    }
    if (!String(actualOrg).startsWith(String(expectOrg))) {
      die(
        `REFUSING: --expect-org said ${expectOrg}, but this token belongs to ${actualOrg}.\n`
          + "Nothing was suspended. Paste a token for the org you meant.",
      );
    }

    console.error(
      `\nSuspension drill for ${capabilityKey}, org ${actualOrg}.\n`
        + "Suspends it, immediately attempts a real write, measures the gap, then re-enables it.\n"
        + "The write carries a stale expectedVersion, so it cannot change the card either way.\n",
    );

    /** Assigned in `finally`, which always runs — so there is no initial value to be read. */
    let restored;
    try {
      const suspended = await callRaw(`/api/fuel-cards/promote/${capabilityKey}`, {
        action: "suspend",
        reason: "Phase 4 exit gate: measuring suspension propagation",
      }, { stepUp: true });
      if (!suspended.ok) {
        console.error(JSON.stringify(suspended.body, null, 2));
        die("The suspend call failed — nothing was suspended, so there is nothing to restore.");
      }
      const suspendedAt = Date.now();
      console.error(`suspended at t+0ms`);

      const attempt = await callRaw(`/api/fuel-cards/${cardId}/lock`, {
        // 16+ chars to satisfy cardVersionSchema, and deliberately not any real version.
        expectedVersion: "STALE-VERSION-FOR-SUSPENSION-DRILL",
        reason: "Phase 4 exit gate: this write is expected to be refused",
        status: "Hold",
        // The write routes require one and validate it as a uuid BEFORE the capability gate runs, so
        // omitting it produced a 400 that never reached the thing being measured. The first run of
        // this drill measured nothing for exactly that reason.
      }, { idempotencyKey: randomUUID() });
      const elapsed = Date.now() - suspendedAt;
      const code = attempt.body?.error?.code ?? "(none)";

      console.error(`write attempted and answered at t+${elapsed}ms  ->  ${attempt.status} ${code}`);
      console.error(
        code === "card_control_suspended"
          ? `\n✓ SUSPENSION PROPAGATED. Upper bound: ${elapsed}ms — the very next call saw it.`
          : `\n✗ NOT the suspension refusal. Got "${code}". If this is a version conflict, the gate did`
            + " NOT stop the write and the card was saved only by optimistic concurrency.",
      );
      console.error(JSON.stringify(attempt.body, null, 2));
    } finally {
      const restore = await callRaw(`/api/fuel-cards/promote/${capabilityKey}`, {
        action: "enable", proofId, reason: "Restoring after the suspension propagation drill",
      }, { stepUp: true });
      restored = restore.ok;
      console.error(
        restored
          ? `\n${capabilityKey} re-enabled — state restored.`
          : `\n*** ${capabilityKey} IS STILL SUSPENDED. Re-enable it by hand: ***\n`
            + `  node scripts/efs.mjs promote ${capabilityKey} --proof ${proofId} --reason "restore"\n`
            + JSON.stringify(restore.body, null, 2),
      );
    }
    if (!restored) process.exit(2);
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
      "commands: scan · inventory [--cards <uuid,uuid>] · echo-scan · sync · job [kind] · suspend-drill --card <id> --proof <id> --expect-org <id> · "
        + "write-check [--read-only] [--status Hold|Inactive] · "
        + "prove <capability> · promote <capability> [--proof <id> | --suspend] --reason <why>\n"
        + "(card numbers and tokens are always prompted for, never passed as flags)\n"
        + "--out <path> writes the result to a file AFTER --expect-org passes; prefer it to `>`,\n"
        + "which your shell truncates before this tool can refuse anything.",
    );
}
