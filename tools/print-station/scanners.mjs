/**
 * The station's scanner relay (SCANNER-RELAY-PLAN.md SR3): read every scanner Silvicom assigned to
 * this machine, and send each read up the station's own connection.
 *
 * ── WHAT IT DOES, AND WHAT IT LEAVES TO THE SERVER ───────────────────────────────────────────
 * Silvicom's answer to each hello names the scanners this station reads (`sync`). For each one the
 * relay finds its port (`resolvePort` — following a Windows renumbering by USB ids), keeps one reader
 * process on it, and turns its bytes into reads (`createFramer`). It never decides which device a
 * read is for: the database does that, at the instant the read arrives (0532, D-SR4).
 *
 * ── A READ IS ABOUT NOW ──────────────────────────────────────────────────────────────────────
 * Reads are sent one at a time, in the order they were made. One that cannot be sent is retried for
 * up to `STATION_READ_HOLD_MS` (30 s, the contract's number and 0532's cap) and then dropped and
 * logged: delivered minutes late, a scan lands in whatever page is open by then (D-SR5). Each read
 * carries its AGE, never this PC's clock, which may be wrong.
 *
 * ── IT CAN NEVER STOP PRINTING ───────────────────────────────────────────────────────────────
 * A refusal of a read (the scanner was retired, a 404 from a Silvicom that has no scanners) drops
 * that read and nothing else. The print loop alone decides that the station has been cut off (D-SR8).
 *
 * ── STATES, FOR SETTINGS ─────────────────────────────────────────────────────────────────────
 * `reading` (port open), `waiting` (no such port — unplugged, or the scanner is still a keyboard),
 * `failed` (the port is there and would not open, with the system's words). While any reader is down
 * the relay looks again every `RETRY_MS`, so a re-plugged scanner reads within seconds, not at the
 * next hello.
 */
import { RefusedError, request } from "./client.mjs";
import { createFramer, resolvePort } from "./serial.mjs";

/** The contract's `STATION_READ_HOLD_MS` — restated because the station imports nothing from the app. */
export const READ_HOLD_MS = 30_000;
export const RETRY_MS = 5_000;
const SEND_TIMEOUT_MS = 10_000;
const SEND_BACKOFF_MS = [500, 1_000, 2_000, 5_000];

export function createScannerRelay(config, deps) {
  /** scannerId → { scanner, port, child, state, error } */
  const readers = new Map();
  const queue = [];
  let ports = [];
  let sending = false;
  let stopped = false;
  let retryTimer = null;

  const scriptPath = deps.scriptPath;

  function stopReader(r) {
    if (r.child) {
      r.expectedExit = true;
      try {
        r.child.kill();
      } catch {
        // already gone
      }
    }
    r.child = null;
  }

  function startReader(r, port) {
    r.port = port;
    r.error = undefined;
    r.expectedExit = false;
    let stderr = "";
    const framer = createFramer((code) => enqueue(r.scanner.id, code), {
      onRefused: (code) => deps.log(`ignored a ${code.length}-character read on ${port}: longer than any code Silvicom takes`),
    });
    const child = deps.spawnReader(port, { scriptPath });
    r.child = child;
    r.state = "reading";
    child.stdout?.on("data", (chunk) => framer.push(chunk));
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-2_000);
    });
    child.on("error", (e) => {
      stderr = `${stderr}\n${e?.message ?? e}`;
    });
    child.on("close", (code) => {
      framer.end();
      if (r.child !== child) return; // replaced or stopped on purpose
      r.child = null;
      if (r.expectedExit || stopped) return;
      const said = stderr.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? `the reader stopped (exit ${code})`;
      r.state = "failed";
      r.error = said.slice(0, 300);
      deps.log(`scanner on ${port} stopped: ${r.error}`);
      scheduleRetry();
    });
    deps.log(`reading scanner on ${port}`);
  }

  function apply() {
    for (const r of readers.values()) {
      const port = resolvePort(r.scanner, ports);
      if (!port) {
        stopReader(r);
        r.state = "waiting";
        r.port = null;
        r.error = undefined;
        continue;
      }
      if (r.child && r.port === port) continue;
      stopReader(r);
      startReader(r, port);
    }
    if ([...readers.values()].some((r) => !r.child)) scheduleRetry();
  }

  function scheduleRetry() {
    if (retryTimer || stopped || readers.size === 0) return;
    retryTimer = setTimeout(async () => {
      retryTimer = null;
      if (stopped) return;
      ports = await deps.listSerialPorts();
      apply();
    }, RETRY_MS);
    retryTimer.unref?.();
  }

  function enqueue(scannerId, code) {
    queue.push({ scannerId, code, at: deps.now() });
    void drain();
  }

  async function drain() {
    if (sending) return;
    sending = true;
    try {
      while (queue.length > 0 && !stopped) {
        const read = queue[0];
        let attempt = 0;
        for (;;) {
          const ageMs = Math.max(0, deps.now() - read.at);
          if (ageMs > READ_HOLD_MS) {
            deps.log(`dropped a read from 30+ seconds ago that could not be sent: ${read.code}`);
            break;
          }
          try {
            const { body } = await request(config.apiUrl, "/api/print-station/scans", {
              method: "POST",
              token: config.token,
              body: { scannerId: read.scannerId, code: read.code, ageMs },
              timeoutMs: SEND_TIMEOUT_MS,
              fetchImpl: deps.fetchImpl,
            });
            deps.log(`read ${read.code} → ${body?.delivered ? "sent to the device using the scanner" : "nobody is using this scanner"}`);
            break;
          } catch (e) {
            if (e instanceof RefusedError) {
              deps.log(`Silvicom refused a read (${e.message}); dropped: ${read.code}`);
              break;
            }
            if (stopped) break;
            await deps.sleep(SEND_BACKOFF_MS[Math.min(attempt, SEND_BACKOFF_MS.length - 1)]);
            attempt += 1;
          }
        }
        queue.shift();
      }
    } finally {
      sending = false;
    }
  }

  return {
    /** Look at the system's ports again; the hello reports what this returns. */
    async refreshPorts() {
      ports = await deps.listSerialPorts();
      return ports;
    },
    ports: () => ports,
    /** Silvicom's list of scanners for this station: start what is new, stop what was removed. */
    sync(assigned) {
      if (stopped || !Array.isArray(assigned)) return;
      const wanted = new Map(assigned.map((s) => [s.id, s]));
      for (const [id, r] of readers) {
        const next = wanted.get(id);
        if (!next) {
          stopReader(r);
          readers.delete(id);
          deps.log(`stopped reading ${r.port ?? r.scanner.portName}: removed in Silvicom`);
        } else {
          r.scanner = next;
        }
      }
      for (const [id, scanner] of wanted) {
        if (!readers.has(id)) readers.set(id, { scanner, port: null, child: null, state: "waiting" });
      }
      apply();
    },
    states() {
      return [...readers.values()].slice(0, 20).map((r) => ({
        scannerId: r.scanner.id,
        state: r.state,
        portName: r.port ?? null,
        ...(r.error ? { error: r.error } : {}),
      }));
    },
    /** Stop every reader. Reads still queued are dropped — the station is going away. */
    stop() {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      for (const r of readers.values()) stopReader(r);
    },
    /** For tests: resolves once every queued read is sent or dropped. */
    async flushed() {
      while (queue.length > 0 || sending) await new Promise((r) => setTimeout(r, 1));
    },
  };
}
