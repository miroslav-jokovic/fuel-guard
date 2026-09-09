/**
 * Structural, not `http.Server`, because `soapClientMtls.test.ts` runs a TLS server: @types/node
 * declares `closeAllConnections` separately on `http.Server` and `https.Server` and NOT on the
 * `net.Server` they both extend, so naming either concrete class would exclude the other.
 */
interface ClosableServer {
  closeAllConnections(): void;
  close(callback?: (error?: Error) => void): unknown;
}

/**
 * Shut a test HTTP server down without waiting on keep-alive sockets (Step 5.4).
 *
 * WHY THIS EXISTS. `apps/api` failed roughly one full run in four under CPU contention, and only
 * under contention — never in isolation, which is why it survived two sightings and eleven clean
 * re-runs before anyone captured it. The evidence, when a run was finally redirected to a log:
 *
 *   TypeError: fetch failed  ·  Caused by: SocketError: other side closed
 *   { code: 'UND_ERR_SOCKET', localAddress: '127.0.0.1', bytesWritten: 177, bytesRead: 0 }
 *
 * and, the same day from the other end, `echoScanRoute.test.ts` timing out in `afterAll` on
 * `server.close()` with "Hook timed out in 10000ms".
 *
 * Those were read as one fault seen from both sides. `fetch` (undici) pools keep-alive connections
 * to 127.0.0.1. Node's `server.close()` stops ACCEPTING but waits for existing connections to end,
 * so a pooled idle socket holds the server open until the hook times out; vitest then tears the
 * worker down with sockets still live, and whichever request is in flight has its connection closed
 * under it — `bytesRead: 0`, a server that accepted and never answered.
 *
 * `closeAllConnections()` (Node >= 18.2) ends those idle sockets so `close()` can complete, and THAT
 * half is fixed: the `afterAll` hook timeout has not been seen since.
 *
 * ── BUT THEY WERE TWO FAULTS, AND ONLY ONE OF THEM WAS THIS ONE (measured 2026-09-08) ───────────
 * The `UND_ERR_SOCKET` half survives this helper. Across 23 controlled full runs of `apps/api` on
 * 2026-09-08 it appeared in 6 of them — about one run in four, which is the rate recorded before the
 * fix — with the identical signature, in five different files (`fuelCardsControl`, `sectionAccess`,
 * `surfaceAccess`, `invitesDelete`, `inspectors`; `savedViews` and `publicInvites` the week's other
 * two). So do not read the paragraph above as a diagnosis of the socket error. It is a diagnosis of
 * the hook timeout, and the two travelled together.
 *
 * What the same measurements RULE OUT, each with numbers, so nobody re-walks this:
 *
 *   · **Connection reuse is not the mechanism.** Disabling client keep-alive entirely (a global
 *     undici `Agent({ pipelining: 0, keepAliveTimeout: 1 })`) gave 3 failures in 8 runs against 1 in
 *     8 for the baseline — no better, same signature. This is the load-bearing one, because the
 *     paragraph above blames pooled keep-alive sockets.
 *   · **Not ephemeral-port reuse.** 300 forced same-port server lifecycles, 0 failures.
 *   · **Not cross-worker parallelism.** Still fails with `--no-file-parallelism`, 1 run in 4.
 *   · **Not CPU starvation on its own.** The worst-hit file passed 8 of 8 in isolation under 14-way
 *     CPU load, and one failing run finished in a normal 18.8 s.
 *   · **Not accumulated servers.** 1,500 sequential listen/fetch/close cycles in one process, 0
 *     failures.
 *   · **Not teardown discipline.** Every suite's `listen(0)` count matches its `closeTestServer()`
 *     count.
 *
 * Two things about its SHAPE that the earlier note had wrong, and that should steer the next
 * attempt. It is not one failure per run: it arrives as a cluster inside a SINGLE file — 10 in
 * `fuelCardsControl`, 7 in `sectionAccess`, 4 in `surfaceAccess`. And where a file shares one server
 * across a describe, the first request dies with `other side closed` and every later test against
 * that same server times out at 5 s; where each test builds its own server, only the individual
 * requests fail. Whatever it is, it poisons one origin at a time.
 *
 * Still true from the original note: no 429, no auth failure, no assertion mismatch. The fault is
 * transport and it is in the harness, not the product. It reproduces only under the full suite —
 * every synthetic model of it above came back clean — so the next step is instrumentation inside a
 * real run, not another standalone repro.
 *
 * Note also what this is NOT: neither `fuelCardVendorLimiter` crossing `createApp()` instances nor
 * `strictLimiter`'s IP keying — the two candidates Step 5.4 originally named — is implicated.
 *
 * Every `apps/api` suite that calls `app.listen(0)` must tear down through here.
 * `testServerTeardown.test.ts` fails the build if one does not — and that gate is worth keeping for
 * the hook-timeout half regardless of the open question above.
 */
export async function closeTestServer(server: ClosableServer): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
