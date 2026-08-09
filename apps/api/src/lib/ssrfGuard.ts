import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Env } from "../env.js";

/**
 * Outbound-request guard — SSRF defence for tenant-supplied URLs.
 *
 * WHY THIS EXISTS. Security audit 2026-08-09, finding 3.8. The EFS SOAP integration lets an ORG ADMIN
 * — a customer, not a platform operator — store an arbitrary `endpointUrl`, and that field was
 * validated as nothing more than `z.string().url()`. The string was then handed verbatim to the SOAP
 * client and dispatched from INSIDE our Railway network, repeatedly, by the poller. The submitter
 * sees the outcome: `EFS returned HTTP <status>`, "EFS returned malformed XML", the transport error
 * text, and `roundtripMs` from /efs-soap/test-connection. That is a complete oracle.
 * `http://169.254.169.254/latest/meta-data/iam/security-credentials/` is the worst case (cloud
 * instance metadata, i.e. credentials); `http://10.x.y.z:8080/` sweeps are the cheap case — internal
 * host and port discovery read straight off the status/error/timing differences.
 *
 * WHAT IT ENFORCES.
 *   1. https ONLY. Not http — plaintext is not acceptable for a financial integration anyway, and the
 *      cloud metadata services answer on port 80 — and certainly not file:/gopher:/ftp:. Our client
 *      does not speak those, but "give a URL fetcher a non-HTTP scheme" is the classic way to turn a
 *      remote fetch into a local file read, so the scheme is allowlisted rather than denylisted.
 *   2. No embedded credentials. `https://user:pass@host/` is not something EFS issues. It is how a
 *      request smuggles auth material to an unintended listener, and it would turn the endpoint URL
 *      into a secret — one that the enable handler writes to the audit log in the clear.
 *   3. The host must resolve ONLY to routable public addresses. EVERY A/AAAA answer is checked and a
 *      single bad one blocks the URL: a name that answers with both a public and a private address is
 *      a DNS-rebinding primitive, not a configuration mistake, and "the first record was fine" is
 *      exactly the check such an attacker is counting on.
 *
 * WHAT IT DOES NOT — AND CANNOT — PROMISE. We validate a name, and then the socket is opened after a
 * SECOND resolution performed inside Node/undici. A hostile nameserver with a zero TTL can answer
 * differently for the two lookups (textbook TOCTOU rebinding). Closing that completely means dialling
 * the already-validated IP and carrying the hostname only in SNI + Host, which neither `fetch` nor our
 * pooled keep-alive https agent expresses cleanly. The residual window is one DNS round trip wide and
 * requires an attacker who already runs an authoritative server; the checks here remove the whole of
 * the trivial attack (IP literals, localhost, metadata addresses, RFC1918 names) and are re-run on
 * every soapFetch call rather than trusted from write time. If we ever need to close the rest, pin the
 * address with the `lookup` option of `https.request` and drop the plain-`fetch` path.
 *
 * Structured result, not an exception, because the write-time caller (routes/integrations.ts) has to
 * turn a failure into the standard 400 envelope. `assertOutboundUrlAllowed()` is the throwing wrapper
 * for the transport layer, where there is no envelope to fill in.
 */

/** Why a URL was refused. Stable enough to branch on; `detail` carries the specifics. */
export type OutboundUrlRejection =
  | "malformed"
  | "scheme"
  | "credentials"
  | "unresolvable"
  | "blocked_address";

export interface OutboundUrlAllowed {
  ok: true;
  /** The parsed-and-renormalised URL. Callers should send/store THIS, so what we checked is what goes
   *  on the wire — no room for a second parser to disagree about the host. */
  url: string;
  /** Host with any IPv6 brackets removed. */
  hostname: string;
  /** Addresses that were checked. Empty when the address checks were bypassed (dev escape hatch). */
  addresses: string[];
}

export interface OutboundUrlBlocked {
  ok: false;
  reason: OutboundUrlRejection;
  /**
   * The full reason, naming the host and the address it resolved to. FOR LOGS AND AUDIT ONLY — it
   * describes our internal network and must never be echoed to the caller who supplied the URL.
   */
  detail: string;
  /**
   * What the caller may be told. Deliberately vague for `unresolvable` and `blocked_address`, and
   * deliberately IDENTICAL for the two: "that host does not resolve" versus "that host resolves
   * somewhere internal" is itself the oracle we are closing, so the API must not distinguish them.
   */
  message: string;
}

export type OutboundUrlCheck = OutboundUrlAllowed | OutboundUrlBlocked;

/** Injected in tests so the DNS cases need no network. Shape matches `dns/promises.lookup(h,{all:true})`. */
export type OutboundDnsLookup = (hostname: string) => Promise<{ address: string; family: number }[]>;

export interface OutboundUrlOptions {
  lookup?: OutboundDnsLookup;
  /** Dev-only escape hatch — see allowPrivateEndpoints(). Scheme and credential checks still apply. */
  allowPrivateAddresses?: boolean;
}

/** Thrown by the transport layer when a request is refused. Message is the caller-safe text; `detail`
 *  is the log-safe one. Callers must NOT retry this — the answer will not change. */
export class BlockedEndpointError extends Error {
  constructor(
    public readonly reason: OutboundUrlRejection | "redirect",
    message: string,
    public readonly detail: string,
  ) {
    super(message);
    this.name = "BlockedEndpointError";
  }
}

/**
 * Development escape hatch, resolved from env, mirroring assertTlsPolicy()'s handling of
 * EFS_SOAP_TLS_INSECURE: pointing the client at a mock SOAP service on localhost or a staging box on a
 * private VLAN is a real thing to want, and shipping it is not. So it is REFUSED — thrown, not warned
 * about — whenever NODE_ENV=production. A warning gets ignored; an exception cannot be.
 *
 * Note this only relaxes the ADDRESS checks. https and "no embedded credentials" hold everywhere,
 * because neither of those has a legitimate development use.
 */
export function allowPrivateEndpoints(env: Env): boolean {
  if (env.EFS_SOAP_ALLOW_PRIVATE_ENDPOINT !== true) return false;
  if (env.NODE_ENV === "production") {
    throw new Error(
      "EFS_SOAP_ALLOW_PRIVATE_ENDPOINT=true is refused in production — it disables the SSRF address checks on the tenant-supplied EFS endpoint (audit 2026-08-09 §3.8). Use a publicly resolvable staging endpoint instead.",
    );
  }
  return true;
}

const defaultLookup: OutboundDnsLookup = (hostname) =>
  // `lookup` (getaddrinfo), not `resolve4`/`resolve6`, on purpose: it is the SAME resolution path the
  // socket layer will take, so /etc/hosts, nsswitch and the A/AAAA preference all agree with what we
  // just validated. `verbatim` keeps every family in the answer rather than reordering/dropping.
  dnsLookup(hostname, { all: true, verbatim: true });

const SAFE_MESSAGE: Record<OutboundUrlRejection, string> = {
  malformed: "That endpoint URL could not be parsed.",
  scheme: "The endpoint URL must use https.",
  credentials: "The endpoint URL must not embed a username or password.",
  unresolvable: "That endpoint host is not allowed.",
  blocked_address: "That endpoint host is not allowed.",
};

function blocked(reason: OutboundUrlRejection, detail: string): OutboundUrlBlocked {
  return { ok: false, reason, detail, message: SAFE_MESSAGE[reason] };
}

/**
 * Validate that `raw` is a URL we are willing to send a request to. Never throws for a bad URL — a bad
 * URL is a result, not an exception. Rejects in the cheap-to-expensive order (parse → scheme →
 * credentials → DNS) so a hostile string cannot make us do a DNS lookup it should never have earned.
 */
export async function checkOutboundUrl(raw: string, opts: OutboundUrlOptions = {}): Promise<OutboundUrlCheck> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return blocked("malformed", "not a parseable absolute URL");
  }
  if (url.protocol !== "https:") {
    return blocked("scheme", `scheme ${url.protocol} is not allowed (https: only)`);
  }
  if (url.username !== "" || url.password !== "") {
    return blocked("credentials", "URL embeds a username and/or password");
  }
  // URL.hostname keeps IPv6 literals bracketed ("[::1]"); every check below wants the bare address.
  const hostname = url.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (hostname === "") return blocked("malformed", "URL has no host");

  if (opts.allowPrivateAddresses) {
    return { ok: true, url: url.toString(), hostname, addresses: [] };
  }

  let addresses: string[];
  if (isIP(hostname) !== 0) {
    // A literal needs no DNS — and must not get one, or an attacker could make us resolve a name we
    // never accepted. Note WHATWG URL has already normalised the decimal/octal/hex IPv4 spellings
    // (`http://2130706433/` → 127.0.0.1) that defeat naive string matching.
    addresses = [hostname];
  } else {
    try {
      addresses = (await (opts.lookup ?? defaultLookup)(hostname)).map((entry) => entry.address);
    } catch (e) {
      return blocked("unresolvable", `DNS lookup for ${hostname} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (addresses.length === 0) return blocked("unresolvable", `DNS lookup for ${hostname} returned no addresses`);
  }

  for (const address of addresses) {
    const why = classifyBlockedAddress(address);
    if (why) return blocked("blocked_address", `${hostname} resolves to ${address} — ${why}`);
  }
  return { ok: true, url: url.toString(), hostname, addresses };
}

/** Throwing form for the transport layer. Returns the normalised URL to send. */
export async function assertOutboundUrlAllowed(raw: string, opts: OutboundUrlOptions = {}): Promise<string> {
  const check = await checkOutboundUrl(raw, opts);
  if (check.ok) return check.url;
  throw new BlockedEndpointError(check.reason, check.message, check.detail);
}

// ── Address classification ──────────────────────────────────────────────────────────────────────
//
// Returns a human label when an address is NOT safe to dial, null when it is. Labels are written for
// the operator reading the log line, so they name the block and why it matters.

/** null ⇒ fine to dial. Anything we cannot confidently parse is refused, not assumed public. */
export function classifyBlockedAddress(address: string): string | null {
  const v4 = parseIpv4(address);
  if (v4 !== null) return classifyIpv4(v4);
  const v6 = parseIpv6(address);
  if (v6 === null) return "not a parseable IP address";
  return classifyIpv6(v6);
}

function parseIpv4(input: string): number | null {
  const parts = input.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    // Leading zeros are refused rather than interpreted: "010" is 8 to inet_aton and 10 to Number,
    // and a guard that disagrees with the resolver about which host it checked is worse than useless.
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function classifyIpv4(value: number): string | null {
  const a = (value >>> 24) & 0xff;
  const b = (value >>> 16) & 0xff;
  const c = (value >>> 8) & 0xff;
  if (a === 0) return "unspecified / this-network (0.0.0.0/8)";
  if (a === 10) return "private (10.0.0.0/8)";
  if (a === 127) return "loopback (127.0.0.0/8)";
  if (a === 100 && b >= 64 && b <= 127) return "carrier-grade NAT (100.64.0.0/10)";
  // 169.254.169.254 lives here. It is the reason this whole file exists, so it is named explicitly.
  if (a === 169 && b === 254) return "link-local, including the cloud instance metadata service (169.254.0.0/16)";
  if (a === 172 && b >= 16 && b <= 31) return "private (172.16.0.0/12)";
  if (a === 192 && b === 0 && c === 0) return "IETF protocol assignments (192.0.0.0/24)";
  if (a === 192 && b === 168) return "private (192.168.0.0/16)";
  if (a === 198 && (b === 18 || b === 19)) return "benchmarking (198.18.0.0/15)";
  if (a >= 224 && a <= 239) return "multicast (224.0.0.0/4)";
  if (a >= 240) return "reserved / broadcast (240.0.0.0/4)";
  return null;
}

/** Parse an IPv6 literal (with optional zone id and trailing dotted-quad) into eight 16-bit groups. */
function parseIpv6(input: string): number[] | null {
  const bare = input.split("%")[0] ?? "";
  const halves = bare.split("::");
  if (halves.length > 2) return null;

  const expand = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    const chunks = part.split(":");
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i] ?? "";
      if (i === chunks.length - 1 && chunk.includes(".")) {
        const embedded = parseIpv4(chunk);
        if (embedded === null) return null;
        groups.push((embedded >>> 16) & 0xffff, embedded & 0xffff);
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(chunk)) return null;
      groups.push(Number.parseInt(chunk, 16));
    }
    return groups;
  };

  const head = expand(halves[0] ?? "");
  if (head === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = expand(halves[1] ?? "");
  if (tail === null) return null;
  const zeros = 8 - head.length - tail.length;
  if (zeros < 0) return null;
  return [...head, ...new Array<number>(zeros).fill(0), ...tail];
}

function classifyIpv6(groups: number[]): string | null {
  const g0 = groups[0] ?? 0;
  if (groups.every((g) => g === 0)) return "unspecified (::)";
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return "loopback (::1)";

  // IPv4 wearing an IPv6 costume. ::ffff:0:0/96 (mapped) is what a dual-stack socket actually connects
  // to, and ::/96 (compatible, deprecated), 64:ff9b::/96 (NAT64) and 2002::/16 (6to4) all embed a v4
  // address that the network will happily route. Classify the address INSIDE, or `::ffff:10.0.0.1`
  // walks straight past an IPv6-only check — the single most common hole in guards like this one.
  const embedded = embeddedIpv4(groups);
  if (embedded !== null) {
    const why = classifyIpv4(embedded);
    return why === null ? null : `${why}, reached via an IPv6-embedded IPv4 address`;
  }

  if ((g0 & 0xffc0) === 0xfe80) return "link-local (fe80::/10)";
  if ((g0 & 0xffc0) === 0xfec0) return "site-local (fec0::/10, deprecated)";
  if ((g0 & 0xfe00) === 0xfc00) return "unique-local (fc00::/7)";
  if ((g0 & 0xff00) === 0xff00) return "multicast (ff00::/8)";
  return null;
}

/** The 32-bit IPv4 address carried inside a mapped/compatible/NAT64/6to4 IPv6 address, else null. */
function embeddedIpv4(groups: number[]): number | null {
  const at = (i: number): number => groups[i] ?? 0;
  const pair = (hi: number, lo: number): number => (((hi << 16) >>> 0) + lo) >>> 0;
  const leadingZeros = groups.slice(0, 5).every((g) => g === 0);
  // ::ffff:a.b.c.d — IPv4-mapped.
  if (leadingZeros && at(5) === 0xffff) return pair(at(6), at(7));
  // ::a.b.c.d — IPv4-compatible (deprecated, still routed by some stacks). :: and ::1 are handled above.
  if (leadingZeros && at(5) === 0) return pair(at(6), at(7));
  // 64:ff9b::/96 and 64:ff9b:1::/48 — NAT64 well-known prefixes.
  if (at(0) === 0x0064 && at(1) === 0xff9b) return pair(at(6), at(7));
  // 2002:a.b.c.d::/48 — 6to4, where the v4 address sits in groups 1 and 2.
  if (at(0) === 0x2002) return pair(at(1), at(2));
  return null;
}
