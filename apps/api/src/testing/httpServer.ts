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
 * Those are one fault seen from both sides. `fetch` (undici) pools keep-alive connections to
 * 127.0.0.1. Node's `server.close()` stops ACCEPTING but waits for existing connections to end, so a
 * pooled idle socket holds the server open until the hook times out; vitest then tears the worker
 * down with sockets still live, and whichever request is in flight has its connection closed under
 * it — `bytesRead: 0`, a server that accepted and never answered.
 *
 * `closeAllConnections()` (Node >= 18.2) ends those idle sockets so `close()` can complete. Note what
 * this is NOT: neither `fuelCardVendorLimiter` crossing `createApp()` instances nor `strictLimiter`'s
 * IP keying — the two candidates Step 5.4 originally named — is implicated. There was no 429, no auth
 * failure and no assertion mismatch anywhere in the captured run. The fault is transport, and it is
 * in the test harness rather than in the product.
 *
 * Every `apps/api` suite that calls `app.listen(0)` must tear down through here.
 * `testServerTeardown.test.ts` fails the build if one does not.
 */
export async function closeTestServer(server: ClosableServer): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
