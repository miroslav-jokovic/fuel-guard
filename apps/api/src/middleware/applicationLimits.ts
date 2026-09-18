import { createHash } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { apiError } from "../lib/http.js";

/**
 * The two budgets in front of the applicant's own link (A0b, `HIRING-MODULE-PLAN.md` §9).
 *
 * ── WHAT WENT WRONG, MEASURED ────────────────────────────────────────────────────────────────────
 * There was one bucket — 20 requests per 60 seconds, keyed by address, across the whole
 * `/api/public/application` prefix — and its argument was about an ATTACKER's request rate: *"a
 * 256-bit token is not guessable at 20 tries a minute or at 20 million"*. True, and it was the only
 * rate anybody counted. **The carrier's packet takes twenty-two POSTs**, one per place on the paper,
 * because `publicApplication.ts` holds that *"twenty-two marks made by one request would be one
 * act"* — so an honest applicant is over the bucket before they reach the last two pages.
 *
 * On 2026-09-17 the first signing ceremony this product ever ran did exactly that: `p03` through
 * `p28` in twenty-three seconds, then `p31a` refused with a 429 it could not explain. **It would
 * have happened to every applicant, every time.** The measurement and its arithmetic are in §10.
 *
 * ── THE SPLIT, AND WHY THE TIGHT NUMBER SURVIVES ─────────────────────────────────────────────────
 * The prefix's 20 a minute is right for what it was sized for: the intake takes a date of birth, a
 * licence number and possibly a Social Security number, and nothing there is ever asked for twenty
 * times. So it **keeps its number and loses the one route it was never sized for**. The ceremony
 * gets its own bucket, sized to the document rather than to the adversary.
 *
 * ── KEYED BY THE LINK, NOT BY THE ADDRESS, AND THAT IS THE LOAD-BEARING CHOICE ────────────────────
 * ⚠ **D-HM9 step 13 puts the packet signing IN THE OFFICE**, on the day the driver arrives. Several
 * applicants signing from one office address is the designed case, not an edge — and under an
 * address key the second driver would spend the first one's budget. `apiRateLimitKey`'s reasoning
 * applies verbatim (C1, `LIVE-MAP-CONCURRENCY-PLAN.md`): *"every dispatcher in one office shares one
 * address"*. Here every applicant in one office would share one packet.
 *
 * ⚠ **Hashed, for that module's reason**: the link token is a credential and a rate-limit key is a
 * map key that outlives the request and can end up in a store dump. Nothing here decodes it or
 * decides anything from it — it is an opaque string used as a bucket label, and a made-up token gets
 * its own bucket and then a 404 from `resolveInvitation`.
 *
 * ⚠ **What stops somebody minting fresh buckets:** the same backstop `apiAddressKey` exists for —
 * `apiAddressCeiling` is mounted on all of `/api` at 18,000 per 15 minutes, which holds one flooding
 * address to ~20 a second no matter how many tokens it invents. And a leaked link cannot be replayed
 * into damage anyway: `application_packet_marks` is unique per (invitation, placement), so the
 * twenty-third request on a real link is `DR034` whatever its rate.
 */

/**
 * What one ceremony costs, with room for the ways a real one goes.
 *
 * Twenty-two marks is the document. Sixty is the document nearly three times over in one minute,
 * which covers a walk, a driver who resumes and re-walks stops the server then refuses as already
 * made, and a double-tap or two — while still holding a single link to something no person does.
 * ⚠ It is deliberately not "22 plus a bit": a number sized to exactly one perfect walk would refuse
 * the first imperfect one, and the imperfect walk is the one this step exists because of.
 */
export const PACKET_CEREMONY_LIMIT = 60;

/** What the intake has always allowed, kept — it is sized for a form, and a form is not a ceremony. */
export const APPLICATION_INTAKE_LIMIT = 20;

/** Enough of a SHA-256 that two live links do not collide. Same width as `apiRateLimitKey`'s. */
const DIGEST_CHARS = 32;

/**
 * Is this the ceremony's own verb?
 *
 * ⚠ Matched on the mounted-relative path, which is `/<token>/mark` — and on POST, so a GET that
 * happens to be shaped like one counts against the intake's bucket where it belongs.
 */
function isPacketMark(req: Request): boolean {
  return req.method === "POST" && /^\/[^/]+\/mark\/?$/.test(req.path);
}

/**
 * Is this request for the applicant's own link, wherever it is asked from?
 *
 * ⚠ Exists for `calcLimiter`, which is mounted on ALL of `/api/public` at 60 a minute keyed by
 * ADDRESS — a THIRD bucket above the two below, and one that would have stopped the ceremony a
 * little further out than the intake's twenty did. Its own comment says what it is for: *"the public
 * calculator is unauthenticated → its own tighter limiter on the abuse surface"*. It was sized and
 * argued when the hazmat calculator was the only thing under that prefix; the application intake and
 * the invitation redemption were mounted beside it later and silently inherited a number nobody had
 * argued for them.
 *
 * ⚠ **60 per address is not survivable for this surface**, and the reason is D-HM9 step 13 again:
 * three applicants signing in the office is 66 marks from one address. The application prefix
 * therefore opts out and carries the two buckets below instead — one tighter than `calcLimiter` for
 * the intake, one keyed per link for the ceremony — with `apiAddressCeiling` still over all of it.
 *
 * ⚠ Matched on the path as `/api/public` sees it, which is `/application/…`.
 */
export function isApplicationLink(req: Request): boolean {
  return req.path === "/application" || req.path.startsWith("/application/");
}

/** The link a request belongs to, as an opaque label. Falls back to the address when there is none. */
export function applicationLinkKey(req: Request): string {
  const token = req.path.split("/").filter(Boolean)[0];
  if (token) {
    return `link:${createHash("sha256").update(token).digest("hex").slice(0, DIGEST_CHARS)}`;
  }
  return `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

/**
 * How this surface refuses, and the two things that were wrong with how it used to.
 *
 * ⚠ **express-rate-limit's default body is plain text**, and `useApplication.ts`'s `publicFetch`
 * reads `body?.error?.code` off a parsed JSON body. A plain-text 429 therefore fails to parse, the
 * code falls back to `invalid_link`, and the driver is told **"This application link is not valid.
 * Ask for a new one."** — about a link that is perfectly good and will work again in a minute. A day
 * went into hunting that link's killer in the abandonment sweep, which had never fired. So the
 * refusal answers in the API's own envelope, with a code the client can act on.
 *
 * ⚠ **And it says so in the log** (A0). The token never goes in the line: it is the credential for a
 * live application, and curing the blindness must not be paid for with a signing link in Railway's
 * log retention. The step after it is enough to tell an applicant's refusal from a scanner's.
 */
function refuse(tag: string, message: string) {
  return (req: Request, res: Response): void => {
    console.warn("[public-application] rate limited", {
      bucket: tag,
      method: req.method,
      step: req.path.split("/").filter(Boolean)[1] ?? "(invitation)",
    });
    res.status(429).json(apiError("too_many_requests", message));
  };
}

/** Everything on the applicant's link EXCEPT the ceremony: unchanged in size, keyed by address. */
export function applicationIntakeLimiter(): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: APPLICATION_INTAKE_LIMIT,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: isPacketMark,
    handler: refuse("intake", "Too many requests from here just now. Wait a minute and try again."),
  });
}

/** The ceremony's own budget: one link, one packet's worth of places, several times over. */
export function packetCeremonyLimiter(): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: PACKET_CEREMONY_LIMIT,
    keyGenerator: applicationLinkKey,
    // ⚠ The intake limiter owns the `RateLimit` headers on this prefix, for `apiAddressCeiling`'s
    // reason: two limiters both writing draft-7 leave the client reading whichever ran last.
    standardHeaders: false,
    legacyHeaders: false,
    skip: (req) => !isPacketMark(req),
    handler: refuse(
      "ceremony",
      "That went through faster than we can record it. Wait about a minute, then press the button "
        + "again — nothing you have already signed is lost.",
    ),
  });
}
