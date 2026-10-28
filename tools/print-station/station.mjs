#!/usr/bin/env node
/**
 * The Silvicom print station (PRINTERS-AND-SCANNERS-PLAN.md PS3).
 *
 * Runs on the always-on machine the label printer is plugged into — the office Windows PC (Q-PS1).
 * It dials OUT to the Silvicom API, waits for print jobs, writes each one's bytes to the printer
 * through the operating system's queue, and reports back. Nothing is opened on the office firewall,
 * and nobody else installs anything: every phone, tablet and computer prints by pressing Print in the
 * browser.
 *
 *   node station.mjs pair <CODE> --api https://<your Silvicom address>   once, with the code from
 *                                                                       Settings → Devices
 *   node station.mjs run                                                 forever (the installer sets
 *                                                                       this to start with Windows)
 *   node station.mjs printers                                            what this machine can print to
 *
 * Options: --config <file> (default: %ProgramData%\Silvicom\PrintStation\config.json on Windows,
 * ~/.silvicom-print-station/config.json elsewhere); --log <file> (default: the console).
 */
import { appendFileSync, renameSync, statSync } from "node:fs";
import { hostname, homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { POLL_TIMEOUT_MS, RefusedError, readConfig, request, validateApiUrl, writeConfig } from "./client.mjs";
import { listPrinters, printRaw } from "./platform.mjs";

export const VERSION = "1.0.0";
/** How often the station re-announces itself and its printers (also its heartbeat between polls). */
export const HELLO_EVERY_MS = 60_000;
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export function defaultConfigPath(platform = process.platform, env = process.env) {
  if (platform === "win32") return join(env.ProgramData ?? "C:\\ProgramData", "Silvicom", "PrintStation", "config.json");
  return join(homedir(), ".silvicom-print-station", "config.json");
}

/**
 * A scheduled task has no console, so `--log <file>` appends there instead (the installer sets it).
 * Kept to ~5 MB: at the limit the file becomes `.1` and a new one starts — a station runs for years.
 */
let logFile = null;
const LOG_LIMIT_BYTES = 5 * 1024 * 1024;
const log = (...parts) => {
  const line = [new Date().toISOString(), ...parts].join(" ");
  if (!logFile) return console.log(line);
  try {
    if (statSync(logFile, { throwIfNoEntry: false })?.size > LOG_LIMIT_BYTES) renameSync(logFile, `${logFile}.1`);
    appendFileSync(logFile, `${line}\n`);
  } catch {
    console.log(line);
  }
};

export async function pair({ code, apiUrl, configPath, fetchImpl = fetch }) {
  const origin = validateApiUrl(apiUrl);
  const { body } = await request(origin, "/api/print-station/pair", {
    method: "POST",
    body: { pairingCode: code, hostName: hostname().slice(0, 120), agentVersion: VERSION },
    fetchImpl,
  });
  writeConfig(configPath, { apiUrl: origin, token: body.token, stationName: body.stationName });
  return body.stationName;
}

async function hello(config, deps) {
  const printers = (await deps.listPrinters()).slice(0, 50);
  await request(config.apiUrl, "/api/print-station/hello", {
    method: "POST",
    token: config.token,
    body: { hostName: deps.hostName.slice(0, 120), agentVersion: VERSION, printers },
    fetchImpl: deps.fetchImpl,
  });
  return printers;
}

/**
 * One job: print it, then report. A print failure is REPORTED (the person sees "Out of paper", or
 * whatever the system said), never thrown — it is the job's outcome, not the station's fault. A
 * report that cannot reach the API is retried a few times; if it never lands, 0526 turns the job
 * `unknown` and the screen offers Retry, which is the honest answer.
 */
export async function handleJob(job, config, deps) {
  let outcome;
  try {
    await deps.printRaw(job.systemName, Buffer.from(job.payloadBase64, "base64"));
    outcome = { ok: true };
    log(`printed ${job.labelCount} label(s) on "${job.systemName}"`);
  } catch (e) {
    outcome = { ok: false, error: String(e?.message ?? e).slice(0, 500) };
    log(`could not print on "${job.systemName}": ${outcome.error}`);
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await request(config.apiUrl, `/api/print-station/jobs/${job.jobId}/report`, {
        method: "POST",
        token: config.token,
        body: outcome,
        fetchImpl: deps.fetchImpl,
      });
      return outcome;
    } catch (e) {
      if (e instanceof RefusedError) throw e;
      await deps.sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
    }
  }
  log(`could not report job ${job.jobId}; Silvicom will show it as "unknown"`);
  return outcome;
}

/**
 * The loop. Returns only when the server refuses the station (revoked, or re-paired elsewhere) or
 * `deps.stop()` says so; every other failure is backed off and retried, forever, because this runs
 * unattended.
 */
export async function runLoop(config, deps) {
  let failures = 0;
  let nextHello = 0;
  while (!deps.stop()) {
    try {
      if (deps.now() >= nextHello) {
        const printers = await hello(config, deps);
        if (nextHello === 0) log(`connected as "${config.stationName}"; printers here: ${printers.map((p) => p.name).join(", ") || "(none)"}`);
        nextHello = deps.now() + HELLO_EVERY_MS;
      }
      const { status, body } = await request(config.apiUrl, "/api/print-station/jobs/next", {
        token: config.token,
        timeoutMs: POLL_TIMEOUT_MS,
        fetchImpl: deps.fetchImpl,
      });
      failures = 0;
      if (status === 200 && body?.job) await handleJob(body.job, config, deps);
    } catch (e) {
      if (e instanceof RefusedError) {
        log(`Silvicom refused this station (${e.message}). Pair it again from Settings → Devices.`);
        return "refused";
      }
      const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)];
      failures += 1;
      log(`cannot reach Silvicom (${e?.message ?? e}); trying again in ${wait / 1000}s`);
      await deps.sleep(wait);
    }
  }
  return "stopped";
}

function argValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(argv) {
  const [command, ...args] = argv;
  const configPath = argValue(args, "--config") ?? defaultConfigPath();
  logFile = argValue(args, "--log") ?? null;
  if (command === "pair") {
    const code = args[0];
    const apiUrl = argValue(args, "--api");
    if (!code || !apiUrl) throw new Error("Usage: node station.mjs pair <CODE> --api https://<your Silvicom address>");
    const name = await pair({ code, apiUrl, configPath });
    console.log(`Paired as "${name}". Saved to ${configPath}. Start it with: node station.mjs run`);
    return 0;
  }
  if (command === "printers") {
    for (const p of await listPrinters()) console.log(p.name);
    return 0;
  }
  if (command === "run") {
    const config = readConfig(configPath);
    let stopping = false;
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => (stopping = true));
    const result = await runLoop(config, {
      fetchImpl: fetch,
      listPrinters: () => listPrinters(),
      printRaw: (name, bytes) => printRaw(name, bytes),
      hostName: hostname(),
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      stop: () => stopping,
    });
    // A refused station exits non-zero so the service manager shows it failed, rather than looping.
    return result === "refused" ? 2 : 0;
  }
  console.log("Usage: node station.mjs pair <CODE> --api <https://…> | run | printers   [--config <file>]");
  return command ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e?.message ?? e);
      process.exit(1);
    },
  );
}
