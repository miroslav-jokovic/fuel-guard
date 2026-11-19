import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * FakeTelnyx Number Lookup — an in-process `node:http` server answering `GET /v2/number_lookup/{e164}` in the
 * shapes Telnyx's OpenAPI page for `LookupNumber` documents (read 2026-11-19): 200 `{ data: { phone_number,
 * valid_number, carrier: { name, normalized_carrier, type, error_code } } }`, 422 `{ errors: [{ code, title,
 * detail }] }`. Anything else a test plants (a 500, a 401, a stall) is the "Unexpected error" default or a fault
 * the page does not document — which is exactly what the reader must survive.
 *
 * Per-number answers are planted by exact number; the default is a mobile on "T-Mobile". `calls` keeps every
 * path, query and Authorization header the reader sent, so a test can hold it to `type=carrier` and the key.
 */

export type FakeLookupAnswer =
  | { status: 200; type: string | null; valid?: boolean; carrier?: string | null }
  | { status: 422; detail?: string }
  | { status: number; body?: unknown }
  | { stall: true };

export class FakeTelnyxLookup {
  readonly calls: Array<{ path: string; query: string; auth: string | undefined }> = [];
  private readonly answers = new Map<string, FakeLookupAnswer>();
  private server: Server | null = null;
  base = "";

  answer(e164: string, a: FakeLookupAnswer): this {
    this.answers.set(e164, a);
    return this;
  }

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://fake");
      this.calls.push({ path: url.pathname, query: url.search, auth: req.headers.authorization });
      const m = /^\/v2\/number_lookup\/([^/]+)$/.exec(url.pathname);
      if (req.method !== "GET" || !m) {
        res.writeHead(404).end();
        return;
      }
      const number = decodeURIComponent(m[1]!);
      const a = this.answers.get(number) ?? { status: 200, type: "mobile", carrier: "T-Mobile" };
      if ("stall" in a) return; // never answers: the reader's timeout must end it
      const send = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
      if (a.status === 200 && "type" in a) {
        send(200, {
          data: {
            record_type: "number_lookup", phone_number: number, country_code: "US", valid_number: a.valid ?? true,
            carrier: { mobile_country_code: "US", mobile_network_code: "260", name: a.carrier ?? null, normalized_carrier: a.carrier ?? null, type: a.type, error_code: null },
          },
        });
      } else if (a.status === 422) {
        send(422, { errors: [{ code: "10027", title: "Unprocessable Entity", detail: "detail" in a && a.detail ? a.detail : "The server understood the syntax of the request but was unable to process the instructions." }] });
      } else {
        send(a.status, "body" in a ? a.body : { errors: [{ code: "10007", title: "Unexpected error" }] });
      }
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }
}
