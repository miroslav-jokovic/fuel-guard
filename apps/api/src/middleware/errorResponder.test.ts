import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../lib/http.js";
import { errorResponder } from "./errorResponder.js";

/**
 * The terminal error handler, and the one class of error it used to mislabel.
 *
 * ── THE INCIDENT (2026-09-01) ──────────────────────────────────────────────────────────────────
 * `express.json()` is strict, so a double-encoded body — a top-level JSON *string* instead of an
 * object — is rejected by body-parser with `type: "entity.parse.failed"` and `status: 400`. That
 * error is not this repo's `HttpError`, so it fell through to the 500 branch and the client was told
 * **"Unexpected server error"** for a request that never reached its handler.
 *
 * It cost an hour on a delete that had nothing wrong with it: the service ran correctly against
 * production when called directly, every database operation succeeded, the route passed end to end
 * in a test. The message ruled out the only thing that was true.
 *
 * So: a 4xx thrown by middleware we did not write is answered as a 4xx, and only what the thrower
 * marked `expose` is echoed (http-errors' own flag for "safe to show"), which is the same line audit
 * L8 draws about never repeating an upstream error verbatim.
 */

const fakeRes = () => {
  const res = {
    headersSent: false,
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
};

const run = (err: unknown) => {
  const res = fakeRes();
  errorResponder(err, {} as never, res as never, (() => {}) as never);
  return res;
};

/** What body-parser actually throws on a strict-mode rejection. */
const bodyParserError = () =>
  Object.assign(new SyntaxError("Unexpected token in JSON at position 0"), {
    type: "entity.parse.failed",
    status: 400,
    statusCode: 400,
    expose: true,
  });

describe("a 4xx from middleware we did not write is a 4xx, not a 500", () => {
  it("answers a malformed body with 400 rather than 'Unexpected server error'", () => {
    const res = run(bodyParserError());
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "invalid_request" } });
    expect(JSON.stringify(res.body)).not.toContain("Unexpected server error");
  });

  it("does not log a client fault as an unhandled error", () => {
    // A 400 logged with a stack is how an error channel stops being read — the same argument this
    // file's header already makes for sub-500 `HttpError`s.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    run(bodyParserError());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("withholds a message the thrower did not mark safe to show", () => {
    const secret = Object.assign(new Error("connect ECONNREFUSED 10.0.0.4:5432 as user svc_admin"), {
      status: 400,
      expose: false,
    });
    const res = run(secret);
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain("ECONNREFUSED");
    expect(JSON.stringify(res.body)).toContain("Malformed request");
  });

  it("honours statusCode when the thrower only sets that", () => {
    expect(run(Object.assign(new Error("nope"), { statusCode: 413, expose: true })).statusCode).toBe(413);
  });
});

describe("everything else is unchanged", () => {
  it("still answers a genuine fault with 500 and says nothing about it", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = run(new Error("a real bug"));
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ error: { code: "internal_error", message: "Unexpected server error" } });
    expect(JSON.stringify(res.body)).not.toContain("a real bug");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("still passes an HttpError through with its own code and message", () => {
    const res = run(new HttpError(409, "duplicate_decal", "That decal is already on another report"));
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ error: { code: "duplicate_decal" } });
  });

  it("treats a 5xx from foreign middleware as a fault, not a client error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = run(Object.assign(new Error("upstream exploded"), { status: 502, expose: true }));
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("upstream exploded");
    spy.mockRestore();
  });

  it("writes nothing once the response has started", () => {
    const res = fakeRes();
    res.headersSent = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    errorResponder(new Error("late"), {} as never, res as never, (() => {}) as never);
    expect(res.statusCode).toBe(0);
    spy.mockRestore();
  });
});
