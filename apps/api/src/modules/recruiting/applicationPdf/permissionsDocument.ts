import { createHash } from "node:crypto";
import {
  APPLICATION_RELEASE_ORDER,
  AUTHORIZATION_PURPOSE_LABELS,
  type ApplicationDraftPayload,
  type ApplicationProgressState,
  type AuthorizationPurpose,
} from "@silvicom/shared";
import {
  DANGER, INK, caption, field, heading, newDrawing, rule, title,
} from "../../../lib/pdfDraw.js";
import { certificate } from "./certificate.js";
import { consentPage, instrumentPage, type SignedConsent, type SignedInstrument } from "./instrumentPages.js";
import type { ApplicationPdfInput } from "./render.js";
import { stampPages } from "./stamp.js";

/**
 * ── WHAT THE OFFICE HAS SIGNED FOR, AS A DOCUMENT (B2) ────────────────────────────────────────
 *
 * The five releases and the 15 U.S.C. 7001(c) consent are signed FIRST, before the applicant types a
 * single answer (D-APP5) — and until this they existed only as rows behind a drawer on a screen
 * nobody outside the office can reach. Every screening act the carrier performs rests on one of them:
 * `SCREENING_PREREQUISITES` names the FCRA disclosure as what makes ordering an MVR lawful and the
 * previous-employer release as what makes a §391.23 inquiry lawful. So the carrier was relying on
 * four instruments **it could not produce** — not because they were not stored, but because there was
 * no way to get them out of the product. The application's own PDF carries them, and it does not
 * exist until the driver certifies, which can be a fortnight later or never.
 *
 * ── WHY IT DOES NOT REFUSE ONCE THE APPLICATION IS FILED, WHERE `preview.ts` DOES ──────────────
 * ⚠ The two refusals look like the same question and are not. `preview.ts` refuses a filed
 * application because its CONTENT is the filed record's content — a second rendering would be an
 * uncited copy of a §391.51(b)(1) document whose bytes do not match the one in the file. This
 * document's content is not in the filed record at all: what gets filed is the carrier's 31-page
 * packet (D-PKT5), and the packet has no page for the releases, the consent or the certificate of
 * completion. So this stays readable for the life of the applicant, because after filing it is still
 * the only document that carries them.
 *
 * ── AND WHY IT IS BANDED ──────────────────────────────────────────────────────────────────────
 * ⚠ Not "DRAFT": every act on this page is real, dated and signed, and calling it a draft would
 * understate five instruments and a consent. What it is NOT is the application — it is rendered on
 * demand, nothing hashes it, nothing cites it, and D-AX8 keeps the filed record single. An office
 * that printed this and filed it as the §391.21 application would have the wrong document in the
 * qualification file, and the band is the only thing on a loose photocopy that can say so.
 */
const PERMISSIONS_BAND = "SIGNED PERMISSIONS - NOT THE APPLICATION";

/** One grant, with whatever later happened to it. Append-only, so a revocation is another row. */
export interface PermissionsInstrument {
  auth: SignedInstrument & {
    method: string;
    accepted_ip: string | null;
    accepted_user_agent: string | null;
  };
  /**
   * Is this the grant in force for its purpose right now?
   *
   * ⚠ Decided by `liveAuthorization` in the service, not by reading a column here — the table is
   * append-only and D-REC3 makes "is this release in force" a fold. `AuthorizationsPanel` folds the
   * same way, and a document that said *signed* about a release the panel calls outstanding would be
   * the D-HM2 disagreement in miniature, except on paper and in somebody's hand.
   */
  live: boolean;
  revoked: { at: string; reason: string | null } | null;
}

export interface PermissionsConsent extends SignedConsent {
  withdrawn_at: string | null;
  applicant_ip: string | null;
  applicant_user_agent: string | null;
}

export interface PermissionsDocumentInput {
  carrier: { name: string; address: string | null };
  /** The office's record of who this is, from `drivers` — the permissions precede any answers. */
  applicant: { first_name: string | null; last_name: string | null };
  invitationId: string;
  renderedAt: Date;
  /** Every grant this invitation collected, oldest first. */
  instruments: readonly PermissionsInstrument[];
  consent: PermissionsConsent | null;
  signatureMark: Buffer | null;
  /**
   * The §391.21(b)(12) certification, once it has been made. Null until then, and the certificate
   * page says so in a sentence rather than printing four rows of em dashes.
   */
  certification: {
    applicationId: string;
    signedName: string;
    certifiedAt: string;
    applicantIp: string | null;
    applicantUserAgent: string | null;
  } | null;
  /** Carried for `certificate()`'s input and deliberately NOT printed — see `drawPermissions`. */
  stage: ApplicationProgressState;
}

const blank = (v: string | null | undefined): string => (v && v.trim() !== "" ? v : "—");
const date = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : "—");
const stamp = (iso: string): string => `${new Date(iso).toISOString().replace("T", " ").slice(0, 19)} UTC`;

/**
 * The digest of what THIS document was drawn from — the signed rows, not the answers.
 *
 * ⚠ `render.ts`'s footer digests the payload because the payload is what its pages show. These pages
 * show instruments, so digesting the payload here would stamp every sheet with the fingerprint of a
 * document it is not — and on the one day somebody tries to match a page to its source, that is worse
 * than no digest at all.
 */
function sourceDigest(input: PermissionsDocumentInput): string {
  const source = {
    invitation: input.invitationId,
    consent: input.consent
      ? { v: input.consent.disclosure_version, at: input.consent.consented_at, w: input.consent.withdrawn_at }
      : null,
    instruments: input.instruments.map((i) => ({
      purpose: i.auth.purpose,
      v: i.auth.disclosure_version,
      at: i.auth.accepted_at,
      revoked: i.revoked?.at ?? null,
    })),
  };
  return createHash("sha256").update(JSON.stringify(source), "utf8").digest("hex");
}

/**
 * The one line per release that answers the office's actual question at a glance.
 *
 * ⚠ It lists `APPLICATION_RELEASE_ORDER` — all five, including the ones NOT signed — because "what
 * has this applicant signed" is half answered by what they have not. A document that printed only
 * the pages it had would read as complete whatever was missing, which is the failure mode a
 * checklist exists to prevent.
 */
function summary(doc: PDFKit.PDFDocument, input: PermissionsDocumentInput): void {
  heading(doc, "What has been signed");

  /**
   * ⚠ **The STATUS leads, and on a lapsed row it is drawn in DANGER (AUD-9).** This column read
   * `Agreed 2026-09-11 · WITHDRAWN 2026-09-17` — the first two words of a withdrawn consent and of a
   * live one were identical, in identical ink, so five rows of this table could only be told apart
   * by reading each of them to the end. The office reads THIS page to answer "what may we rely on";
   * a reader scanning the left edge of the value column now gets the answer there.
   * ⚠ Colour does not carry it alone: the word is first and it is in capitals (D-AVI22).
   */
  field(
    doc,
    "Consent to sign electronically",
    !input.consent
      ? "Not agreed yet"
      : input.consent.withdrawn_at
        ? `WITHDRAWN ${date(input.consent.withdrawn_at)} · agreed ${date(input.consent.consented_at)}`
        : `Agreed ${date(input.consent.consented_at)} · version ${input.consent.disclosure_version}`,
    input.consent?.withdrawn_at ? DANGER : INK,
  );

  for (const purpose of APPLICATION_RELEASE_ORDER) {
    const forPurpose = input.instruments.filter((i) => i.auth.purpose === purpose);
    const live = forPurpose.find((i) => i.live) ?? null;
    const lapsed = forPurpose[forPurpose.length - 1] ?? null;
    field(
      doc,
      AUTHORIZATION_PURPOSE_LABELS[purpose as AuthorizationPurpose] ?? purpose,
      live
        ? `Signed ${date(live.auth.accepted_at)} · wording ${live.auth.disclosure_version}`
        : lapsed
          ? `REVOKED ${date(lapsed.revoked?.at)} · signed ${date(lapsed.auth.accepted_at)}`
          : "Not signed yet",
      !live && lapsed ? DANGER : INK,
    );
  }
  // ⚠ Until 2026-09-24 a sentence followed these rows saying the Clearinghouse consent "is given
  // inside the FMCSA portal, not here". D-AF4 made the limited-query consent the fifth release, so it
  // is a row above now, and the sentence would print a falsehood beside it. `AuthorizationsPanel`
  // dropped its copy of the sentence in the same change.
}

/** What `certificate()` draws its page from — the same input shape the filed document uses. */
function certificateInput(input: PermissionsDocumentInput): ApplicationPdfInput {
  const cert = input.certification;
  return {
    carrier: input.carrier,
    /**
     * ⚠ The two name fields and nothing else, cast rather than parsed. `certificate()` reads
     * `first_name`/`last_name` off this to label the applicant, and this document has no answers to
     * carry: at step two of the hire the permissions are signed and `application_drafts` is usually
     * empty, which is the whole reason this document exists separately from the preview.
     */
    application: {
      first_name: input.applicant.first_name ?? "",
      last_name: input.applicant.last_name ?? "",
    } as ApplicationDraftPayload,
    applicationId: cert?.applicationId ?? input.invitationId,
    certifiedAt: cert?.certifiedAt ?? null,
    signedName: cert?.signedName ?? "",
    applicantIp: cert?.applicantIp ?? null,
    applicantUserAgent: cert?.applicantUserAgent ?? null,
    signatureMark: input.signatureMark,
    authorizations: input.instruments.map((i) => i.auth),
    /**
     * ⚠ Null once the applicant HAS certified, and that is not cosmetic: `certificate()`'s preview
     * branch prints *"Not signed yet"* under §391.21(b)(12), which is true on the day the permissions
     * are signed and false a fortnight later. This document outlives the filing (see the header), so
     * it has to tell the truth on both sides of it.
     */
    preview: cert ? null : { stage: input.stage },
    esignConsent: input.consent,
  };
}

/**
 * ⚠ The stage is NOT printed anywhere on this document, and that is A2's ruling rather than an
 * oversight: *"the stage is on the applicant's record, which is where a recruiter reads it anyway; a
 * document's job is to be the document"*. It is carried because `certificate()` takes the filed
 * document's whole input and that input holds one, and inventing a value for a field a later reader
 * might start printing is how a document comes to assert something nobody checked.
 */
export async function renderPermissionsDocument(input: PermissionsDocumentInput): Promise<Buffer> {
  const name = blank([input.applicant.first_name, input.applicant.last_name].filter(Boolean).join(" "));
  // Buffered: the footer names the page out of the total, which is not known until the certificate
  // has been drawn. `stamp.ts`'s header has the rest of the page-machinery warnings.
  const { doc, done } = newDrawing(`Signed permissions — ${name}`, { bufferPages: true });

  title(doc, "Signed permissions");
  // ⚠ The document's lede, and the one `muted()` on this page that has something under it. The
  // Clearinghouse line in `summary()` is a trailing footnote with nothing after it and stays
  // `muted()` — the distinction AUD-8 turns on is whether a line introduces a block or closes one.
  caption(
    doc,
    "The releases and consent this applicant has signed, each with the exact wording it was signed "
    + "against. Rendered from the carrier's records at the moment it was asked for. It is not the "
    + "§391.21 application and is not part of any qualification file.",
  );
  rule(doc);

  field(doc, "Carrier", blank(input.carrier.name));
  if (input.carrier.address) field(doc, "Address", input.carrier.address);
  field(doc, "Applicant", name);
  field(doc, "Invitation", input.invitationId);
  // The moment this copy was produced, so two printouts of the same applicant taken a week apart can
  // be told apart — they are allowed to differ, because a release can be revoked between them.
  field(doc, "Rendered", stamp(input.renderedAt.toISOString()));

  summary(doc, input);

  if (input.consent) {
    consentPage(
      doc,
      input.consent,
      input.consent.withdrawn_at
        ? {
            headline: `WITHDRAWN ${stamp(input.consent.withdrawn_at)}`,
            detail:
              "Withdrawal stops the electronic path going forward under 7001(c)(1)(B)(i)(II); it "
              + "does not undo signatures already given.",
          }
        : null,
    );
  }

  for (const instrument of input.instruments) {
    instrumentPage(
      doc,
      instrument.auth,
      input.signatureMark,
      instrument.revoked
        ? {
            headline: `REVOKED ${stamp(instrument.revoked.at)}`,
            detail:
              "The carrier may not rely on this release for any screening act after that moment. "
              + `Reason given: ${blank(instrument.revoked.reason)}`,
          }
        : null,
    );
  }

  certificate(doc, certificateInput(input), { source: "signed permissions" });

  stampPages(doc, {
    name,
    // "invitation", because that is what the id IS — there is no `driver_applications` row for most
    // of this document's life, and a footer calling it an application id would send whoever chased it
    // to a table with no such row.
    reference: `permissions on invitation ${input.invitationId}`,
    digest: sourceDigest(input),
    band: PERMISSIONS_BAND,
  });
  doc.end();
  return done;
}
