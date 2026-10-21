import { computed, ref, watch, type Ref } from "vue";
import { isLive, putCopy, readCopy, type CopyRow } from "./deviceCopies";
import { APPLY_COPY } from "./strings";

/**
 * What this device remembers about a link, so an EXPIRED one can say the right thing
 * (APPLICATION-FLOW-V2-PLAN Q-AW56 (e), owner confirmed 2026-10-21).
 *
 * ── THE CASE ──────────────────────────────────────────────────────────────────────────────────
 * Measured on production 2026-10-20: two applicants finished Part 1 — the consent, their details, the
 * documents, all six permissions — on 10-01, and their links expired on 10-14 and 10-15 while the
 * office had not yet sent the application. From `releasesCompletedAt` on, the clock is the office's:
 * there is nothing left for the applicant to do on the link until the office sends the form (and
 * `send_application_invitation` revives and extends the link when it does). Yet the reopened link said
 * "This link is not valid … ask for a new one", as if their work were lost. Stopping the clock instead
 * (Q-AW56 (d)) was refused: it would keep a link holding a date of birth and six signed instruments
 * open for as long as the office takes, which is the exposure M3 (audit 2026-10-20) closed at the
 * other end of the process. So the clock stays and the words change.
 *
 * ── WHY THE DEVICE, AND NOT THE SERVER ────────────────────────────────────────────────────────
 * The server answers every dead link identically (`resolveInvitation`, A1): expired, revoked and
 * never-existed are one refusal, because telling them apart would let whoever holds a leaked or
 * scanned link (Proofpoint opens invitation links) learn that a named person applied for a job at a
 * named carrier and how far they got. That rule is not loosened here. The page instead remembers, on
 * the device the link was walked on, how far it got — written on every live load, read only once the
 * server has said the link is dead — and says the finished sentence only where the memo says Part 1
 * was done, nothing was left for the applicant to fill, and the link's own expiry has passed. A
 * different phone, or cleared storage, sees the neutral card, which is still true and still offers
 * the only action that helps. A link that died EARLY on the device that finished Part 1 gets the
 * "replaced" words (`deadLinkWording`), added 2026-10-21.
 *
 * ── WHAT IS KEPT ──────────────────────────────────────────────────────────────────────────────
 * A hash of the token (domain-separated, so it is never the database's `token_hash`), three booleans
 * about the phases, the link's expiry and the memo's own. Never the token: a bearer credential at
 * rest on a device is what the `localKey` design (C3d1a) exists to avoid, and the token cannot be the
 * key for the same reason it is hashed. Never a name, a date or an answer. The memo outlives the link
 * by `LINK_MEMO_GRACE_MS`, because it is read exactly when the link has died; after that it is swept
 * like every other copy (`readCopy` deletes what `isLive` refuses, whoever's it is).
 */

/** Bumped when `LinkMemo` changes shape; a memo of another version is deleted, never read. */
export const LINK_MEMO_VERSION = 1;
/** How long after the link's expiry the memo is still readable — the window a reopened link lands in. */
export const LINK_MEMO_GRACE_MS = 90 * 24 * 60 * 60 * 1000;

export interface LinkMemo extends CopyRow {
  linkExpiresAt: string;
  /** `releasesCompletedAt` was set: the consent, Part 1 and every permission were done. */
  partOneDone: boolean;
  /** The office had sent the application form — so the next move was the applicant's again. */
  applicationSent: boolean;
  /** The application was certified and sent back — nothing was left to fill. */
  submitted: boolean;
}

/** The slice of the bundle the memo is written from. `ApplyInvitation` satisfies it. */
export interface LinkFacts {
  expiresAt: string;
  /** Optional: a bundle cached from before the phases were served has none, and remembers nothing done. */
  phases?: {
    releasesCompletedAt: string | null;
    applicationSentAt?: string | null;
    submittedAt: string | null;
  };
}

/**
 * The memo's key: SHA-256 of the token under its own prefix, so a device holds neither the bearer
 * token nor the value the database indexes it by. Null where the browser has no WebCrypto (an
 * insecure origin): then no memo is kept and the dead card stays neutral, which is still true.
 */
export async function linkMemoKey(token: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || !token) return null;
  try {
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(`apply-link-memo:${token}`));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/** Written on every live load, so a revived link (a later expiry) and a passed phase both land. */
export async function rememberLink(token: string, facts: LinkFacts, now: Date = new Date()): Promise<void> {
  const key = await linkMemoKey(token);
  if (!key) return;
  const linkExpiry = Date.parse(facts.expiresAt);
  const from = Number.isNaN(linkExpiry) ? now.getTime() : linkExpiry;
  await putCopy<LinkMemo>("links", {
    key,
    version: LINK_MEMO_VERSION,
    linkExpiresAt: facts.expiresAt,
    partOneDone: Boolean(facts.phases?.releasesCompletedAt),
    applicationSent: Boolean(facts.phases?.applicationSentAt),
    submitted: Boolean(facts.phases?.submittedAt),
    expiresAt: new Date(from + LINK_MEMO_GRACE_MS).toISOString(),
  });
}

/** This link's memo, if it is still readable — after sweeping every memo that is not. */
export async function readLinkMemo(token: string, now: Date = new Date()): Promise<LinkMemo | null> {
  const key = await linkMemoKey(token);
  if (!key) return null;
  return readCopy<LinkMemo>("links", key, (row) => isLive(row, LINK_MEMO_VERSION, now));
}

export type DeadLinkWording = "neutral" | "finished" | "replaced";

/**
 * Which card a dead link gets.
 *
 * "Finished" needs all three: the memo says Part 1 was done; nothing was left for the applicant to fill
 * (either the form was never sent, or it was sent and came back certified); and the link's own expiry
 * has passed.
 *
 * "Replaced" is a link dead BEFORE its time on a device that finished Part 1 and has not sent the form
 * back. Measured on production 2026-10-21: an applicant finished Part 1 at 17:50, the office pressed
 * "Send application" at 18:41 — which rotates the email's token (D-AF7, `send_application_invitation`)
 * — and the applicant filled Part 2 from the text's link, then went back to the Part 1 tab still open on
 * the same phone and was told "This link is not valid", five times in six minutes. It read as being
 * thrown out. The memo cannot tell a replaced link from a revoked one, and the server will not (A1), so
 * the words name the likely cause and the action that helps in both: open the newest message, and ask
 * if there is none. Nothing about the application is claimed beyond what this device saw.
 *
 * Everything else is neutral — including a link dead early after the form came back certified, which
 * is a hire ending the link (M3), not a newer one waiting in the applicant's messages.
 */
export function deadLinkWording(memo: LinkMemo | null, now: Date): DeadLinkWording {
  if (!memo) return "neutral";
  if (!memo.partOneDone) return "neutral";
  if (Date.parse(memo.linkExpiresAt) > now.getTime()) return memo.submitted ? "neutral" : "replaced";
  if (memo.applicationSent && !memo.submitted) return "neutral";
  return "finished";
}

export interface DeadLinkCopy {
  heading: string;
  body: string;
}

/**
 * The dead card's words for this link: remembers the link while it is live, and reads the memo back
 * once the server has refused it. Neutral until the memo has been read, and neutral again when the
 * query recovers — the copy is only ever shown behind `isError`.
 */
export function useLinkMemo(
  token: Ref<string>,
  invitation: { data: Ref<LinkFacts | undefined>; isError: Ref<boolean> },
  now: () => Date = () => new Date(),
): Ref<DeadLinkCopy> {
  const wording = ref<DeadLinkWording>("neutral");
  watch(
    () => invitation.data.value,
    (facts) => {
      if (facts) void rememberLink(token.value, facts, now());
    },
    { immediate: true },
  );
  watch(
    () => invitation.isError.value,
    async (dead) => {
      if (!dead) {
        wording.value = "neutral";
        return;
      }
      const asked = token.value;
      const answer = deadLinkWording(await readLinkMemo(asked, now()), now());
      // A link that changed under the read is answered by its own read, not this one.
      if (token.value === asked) wording.value = answer;
    },
    { immediate: true },
  );
  return computed<DeadLinkCopy>(() =>
    wording.value === "neutral"
      ? { heading: APPLY_COPY.dead.heading, body: APPLY_COPY.dead.body }
      : APPLY_COPY.dead[wording.value],
  );
}
