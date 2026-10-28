import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RefusedError, readConfig, request, validateApiUrl, writeConfig } from "./client.mjs";

test("the token only ever travels to an https origin", () => {
  assert.equal(validateApiUrl("https://app.example.com/"), "https://app.example.com");
  assert.equal(validateApiUrl("http://localhost:4000"), "http://localhost:4000");
  assert.throws(() => validateApiUrl("http://app.example.com"), /https/);
  assert.throws(() => validateApiUrl("https://app.example.com/api"), /origin only/);
  assert.throws(() => validateApiUrl("https://user:pw@app.example.com"), /origin only/);
  assert.throws(() => validateApiUrl("not a url"), /not a URL/);
});

const respond = (status, body) => async () => new Response(body === undefined ? null : JSON.stringify(body), { status });

test("a refusal is RefusedError with the server's message, and is never a retryable error", async () => {
  await assert.rejects(
    request("https://x.test", "/a", { fetchImpl: respond(401, { error: { code: "unauthorized", message: "Invalid print station token" } }) }),
    (e) => e instanceof RefusedError && e.status === 401 && /Invalid print station token/.test(e.message),
  );
});

test("a 5xx and a 429 are transient, not refusals", async () => {
  for (const status of [500, 503, 429]) {
    await assert.rejects(request("https://x.test", "/a", { fetchImpl: respond(status, {}) }), (e) => !(e instanceof RefusedError));
  }
});

test("a 204 from the long poll is an empty answer, not an error", async () => {
  assert.deepEqual(await request("https://x.test", "/a", { fetchImpl: respond(204) }), { status: 204, body: null });
});

test("the config is written whole and read back; one without a token is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "station-"));
  const path = join(dir, "nested", "config.json");
  writeConfig(path, { apiUrl: "https://app.example.com", token: "t0k", stationName: "Office PC" });
  assert.deepEqual(readConfig(path), { apiUrl: "https://app.example.com", token: "t0k", stationName: "Office PC" });
  writeConfig(path, { apiUrl: "https://app.example.com" });
  assert.throws(() => readConfig(path), /pair again/);
  assert.ok(JSON.parse(readFileSync(path, "utf8")));
});
