/**
 * Every typing error corrected in the carrier's packet — the whole difference between their file and
 * what prints (D-PKT20, owner 2026-09-25).
 *
 * ── WHY THE PACKET IS CORRECTED NOW, WHEN D-PKT11 SAID NEVER ─────────────────────────────────────
 * D-PKT11 (2026-09-14) printed the packet exactly as written, typos included, on the reading that the
 * text was counsel's work and a misspelling might be a negotiated word. The owner has since said
 * where the text came from: *"my secretary retyped this application so lets fix spelling
 * mistakes"*. A typing error in a retyped document is the secretary's, not the lawyer's, and
 * reproducing it is reproducing a transcription defect — the same reasoning D-PKT11's own
 * ligature carve-out already applied to the Numbers export.
 *
 * ── WHAT COUNTS AS A CORRECTION (and the guard that holds the line) ───────────────────────────
 * A misspelled word, or a wrong word where the intended one is certain from the text itself —
 * `natural arbitrator` where the same sentence later says `neutral arbitrator`. NOT a missing word,
 * a garbled or repeated sentence, or punctuation: supplying those is drafting, and they are listed
 * for the owner and counsel in `MVR-RELEASE-AND-TEMPLATES-PLAN.md` §7 instead.
 *
 * `packetSpelling.test.ts` holds the line mechanically, as `packetWording.ts`'s repairs always were:
 * a `spelling` entry keeps its word count (no clause can hide inside a "typo fix"); a `split` only
 * adds spaces and a `join` only removes one; anything else is a `character` fix and must say why.
 *
 * ── HOW IT IS APPLIED ─────────────────────────────────────────────────────────────────────────
 * To the printed packet by `packetSpellingPatch.ts`, glyph for glyph inside the carrier's own lines,
 * and to the permissions transcribed from pages 15, 19, 20 and 22 by `packetWording.ts` — one list,
 * so the page and the permission can never be corrected differently.
 *
 * ⚠ **Phrases before the words they contain**, and `times` is how often the entry occurs on that
 * page of the carrier's PDF. The patcher throws if the count is wrong, so an entry that stops
 * matching can never quietly print the misspelling again.
 */
export interface PacketSpelling {
  /** The carrier's page number, from its footer. */
  page: number;
  /** Exactly as the carrier's PDF spells it, inside one printed line. */
  wrong: string;
  right: string;
  /**
   * `ruling` is not spelling: a change the OWNER ruled, which may change words and figures
   * (`packetFines.ts`, D-PKT21). It must say why, and it is never mistaken for a typo fix.
   */
  kind: "spelling" | "split" | "join" | "character" | "ruling";
  /** How often it occurs on the page (default 1). */
  times?: number;
  /**
   * Which of the page's printed runs holding `wrong` this entry changes, 1-based, in the order the
   * carrier's PDF draws them — for text that repeats on a page and must change in only some places
   * (page 7 prints `$..1,500.00` three times, for three different offences). Counted over the
   * carrier's ORIGINAL text, so an earlier entry cannot shift the count.
   */
  nth?: readonly number[];
  /** Required for `character`, and for any correction to a CONTRACT page (29–31). */
  why?: string;
}

const s = (page: number, wrong: string, right: string, times?: number): PacketSpelling => ({ page, wrong, right, kind: "spelling", times });
const split = (page: number, wrong: string, right: string, times?: number): PacketSpelling => ({ page, wrong, right, kind: "split", times });

export const PACKET_SPELLING: readonly PacketSpelling[] = [
  // ── page 1 · Commercial driver information
  s(1, "maritial", "marital"),
  s(1, "reisdency", "residency"),
  // ── page 2 · §383.21 quoted: "more than one driver's license"
  s(2, "that one driver's license", "than one driver's license"),
  s(2, "FORFEITTURES", "FORFEITURES"),
  // ── page 4 · Independent Contractor Notification & Release (withdrawn from signing, L-1; still printed)
  s(4, "typyes", "types"),
  split(4, "concerningmy", "concerning my"),
  split(4, "fromDOT", "from DOT"),
  s(4, "concering", "concerning"),
  s(4, "whcihc", "which"),
  s(4, "with your if I am hired", "with you if I am hired"),
  // ── page 5 · Qualifications
  s(5, "emploment", "employment"),
  s(5, "odl", "old"),
  s(5, "Prevous", "Previous"),
  s(5, "prevous", "previous"),
  s(5, "clasess", "classes"),
  s(5, "recless", "reckless"),
  s(5, "violatinos", "violations"),
  s(5, "accidnets", "accidents"),
  // ── page 6 · Documents, criminal history
  s(6, "birht", "birth"),
  s(6, "Misdemenors", "Misdemeanors"),
  s(6, "examinded", "examined"),
  s(6, "incarccerated", "incarcerated"),
  // ── page 7 · Rules and regulations (part 1)
  s(7, "IMPOREPER", "IMPROPER"),
  s(7, "OVERWIGHT", "OVERWEIGHT"),
  // ── page 8 · Rules and regulations (part 2)
  s(8, "YOU WIL INSPECT", "YOU WILL INSPECT"),
  s(8, "CONDTION", "CONDITION"),
  s(8, "RECIVED", "RECEIVED"),
  s(8, "EXEPTED", "EXCEPTED"),
  s(8, "MANGER", "MANAGER"),
  // ── page 9 · Rules and regulations (part 3)
  s(9, "indepenent contractos", "independent contractors"),
  s(9, "prevous", "previous", 2),
  s(9, "unquilifed", "unqualified"),
  s(9, "unathorized", "unauthorized"),
  s(9, "Unathorized", "Unauthorized"),
  s(9, "ddrive", "drive"),
  split(9, "arenot", "are not"),
  s(9, "calls wil be", "calls will be"),
  s(9, "licnse", "license"),
  s(9, "overwight", "overweight"),
  s(9, "praking", "parking"),
  // ── page 10 · Rules and regulations (part 4)
  s(10, "permission wil result", "permission will result"),
  s(10, "disqualifation", "disqualification"),
  s(10, "withing", "within"),
  split(10, "resultin", "result in"),
  s(10, "immedicately", "immediately"),
  s(10, "ATTACGED", "ATTACHED"),
  s(10, "forgoing", "foregoing"),
  s(10, "parrk", "part"),
  s(10, "ellective", "effective"),
  // ── page 11 · Employment record, the authorization and the certification
  s(11, "commerical", "commercial"),
  s(11, "SINGED", "SIGNED"),
  s(11, "make sure investigations and inquires", "make such investigations and inquiries"),
  s(11, "heatlh", "health"),
  s(11, "employement", "employment"),
  s(11, "applicaton", "application"),
  s(11, "previuous", "previous"),
  {
    page: 11, wrong: "€.", right: "(e).", kind: "character",
    why: "A euro sign standing where `(e)` belongs, wrapped alone onto its own line after `49 CFR 391.23(d) and`: §391.23(d) and (e) are the investigation paragraphs, and page 15 makes the same substitution.",
  },
  // ── pages 12–13 · Verification log
  s(12, "BACKFROUNG", "BACKGROUND"),
  s(13, "BACKFROUNG", "BACKGROUND"),
  s(13, "as my be necessary", "as may be necessary"),
  s(13, "preiod", "period"),
  // ── page 14 · Previous-employer inquiry form
  s(14, "Operaton", "Operation"),
  s(14, "infromation", "information"),
  // ── page 15 · Past employment verification (the `previous_employer` permission's text)
  s(15, "infromation form previous emplyer(s)", "information from previous employer(s)"),
  s(15, "has not yer received", "has not yet received"),
  s(15, "withing 30 days", "within 30 days"),
  s(15, "INC they above requested", "INC the above requested"),
  s(15, "and with to review", "and wish to review"),
  s(15, "ahuthorize", "authorize"),
  s(15, "emplyer/school", "employer/school", 3),
  s(15, "emplyment", "employment", 2),
  s(15, "adultered", "adulterated"),
  s(15, "preivious", "previous"),
  s(15, "certy", "certify"),
  s(15, "prvious", "previous"),
  s(15, "emloyers", "employers"),
  s(15, "paragrafs", "paragraphs"),
  s(15, "emplyers", "employers"),
  s(15, "requlated", "regulated"),
  s(15, "emplyed", "employed"),
  s(15, "infromation", "information"),
  s(15, "howerver", "however"),
  split(15, "applicanthas", "applicant has"),
  {
    page: 15, wrong: "(d) and €", right: "(d) and (e)", kind: "character",
    why: "A euro sign standing where `(e)` belongs, in `paragraphs (d) and (e) of Section 391.23`.",
  },
  // ── page 16 · Education and training
  s(16, "benfit", "benefit"),
  s(16, "This references", "These references"),
  // ── page 17 · The applicant's certification
  {
    page: 17, wrong: "1 am not considered", right: "I am not considered", kind: "character",
    why: "The digit 1 standing for the pronoun I.",
  },
  s(17, "highway use faxes", "highway use taxes"),
  s(17, "charged buck every week", "charged back every week"),
  s(17, "und does not show", "and does not show"),
  // ── page 18 · CDL certification of compliance
  s(18, "COMERCIAL", "COMMERCIAL"),
  // ── page 20 · FCRA disclosure (the `fcra_disclosure` permission's text)
  { page: 20, wrong: "T he purpose", right: "The purpose", kind: "join" },
  {
    page: 20, wrong: "1681-168lu", right: "1681-1681u", kind: "character",
    why: "A lower-case L standing where 1 belongs, in the FCRA's own section range, 15 U.S.C. §§1681–1681u.",
  },
  // ── page 21 · Seven day work statement
  s(21, "Carier", "Carrier"),
  s(21, "firt", "first"),
  s(21, "Motor Cartist", "Motor Carrier"),
  s(21, "carrer", "carrier"),
  s(21, "must he signed", "must be signed"),
  // ── page 22 · Urinalysis notification (the `drug_alcohol` permission's text)
  s(22, "The medical Review Officer", "The Medical Review Officer"),
  s(22, "signatrure", "signature"),
  s(22, "reprsentative's", "representative's"),
  // ── page 23 · Annual review of driving record
  s(23, "QUATERLY", "QUARTERLY", 2),
  s(23, "are regarded to provide", "are required to provide"),
  s(23, "ail violates of traffic", "all violations of traffic"),
  split(23, "orbond", "or bond"),
  s(23, "Seurity", "Security"),
  s(23, "signatrure", "signature"),
  {
    page: 23, wrong: "traffic s solutions", right: "traffic violations", kind: "character",
    why: "One word garbled into two: the certification lists traffic VIOLATIONS, as its own heading and the next line (`other than parking violations`) say. Drops a word, so it cannot pass as spelling.",
  },
  s(23, "parting violations", "parking violations"),
  s(23, "forfeited band", "forfeited bond"),
  { page: 23, wrong: "above, ( certify", right: "above, I certify", kind: "character", why: "A bracket standing for the pronoun I." },
  s(23, "shelf review", "shall review"),
  s(23, "Fails to quality", "Fails to qualify"),
  // ── page 24 · Driver safety training
  s(24, "familirize", "familiarize"),
  s(24, "requred", "required"),
  s(24, "which eluded additional", "which included additional"),
  s(24, "und get further", "and get further"),
  s(24, "followign", "following"),
  s(24, "informend", "informed"),
  s(24, "company fues", "company rules"),
  s(24, "expalined", "explained"),
  s(24, "signatrure", "signature", 2),
  // ── page 25 · Handbook receipt
  s(25, "Safety Registration", "Safety Regulations"),
  s(25, "Administraton", "Administration"),
  // ── page 26 · §40.25(j) question
  s(26, "administrated", "administered"),
  // ── page 27 · Passengers, off-duty time
  s(27, "than relived", "then relieved"),
  // ── pages 29–31 · Owner Operator & Leased Driver Agreement (a CONTRACT: every entry says why)
  { page: 29, wrong: "(Carier)", right: "(Carrier)", kind: "spelling", why: "The defined term, spelled `Carrier` everywhere else in the agreement." },
  { page: 29, wrong: "helth", right: "health", kind: "spelling", why: "Misspelling." },
  { page: 29, wrong: "serivces", right: "services", kind: "spelling", why: "Misspelling." },
  { page: 29, wrong: "beneft", right: "benefit", kind: "spelling", why: "Misspelling." },
  { page: 29, wrong: "disptacher", right: "dispatcher", kind: "spelling", why: "Misspelling." },
  { page: 29, wrong: "Untill the statue", right: "Until the statute", kind: "spelling", why: "`statute of limitation` — a statue is a sculpture." },
  { page: 29, wrong: "appearance at trail", right: "appearance at trial", kind: "spelling", why: "Deposition and appearance at TRIAL, in a list of litigation steps." },
  { page: 30, wrong: "if l do not", right: "if I do not", kind: "character", why: "A lower-case L standing for the pronoun I." },
  { page: 30, wrong: "appoint one arbitration", right: "appoint one arbitrator", kind: "spelling", why: "Each party appoints an arbitrator; the next words are `and arbitrators so appointed`." },
  { page: 30, wrong: "a natural arbitrator", right: "a neutral arbitrator", kind: "spelling", why: "The same clause later says `the neutral arbitrator`." },
  { page: 30, wrong: "bending on the parties", right: "binding on the parties", kind: "spelling", why: "The clause opens `binding arbitration`; a determination is binding on the parties." },
  { page: 30, wrong: "shall not he appeasable", right: "shall not be appealable", kind: "spelling", why: "`be appealable` — the standard finality term of an arbitration clause; `appeasable` is not a legal word." },
  { page: 30, wrong: "correction. Driver further", right: "coercion. Driver further", kind: "spelling", why: "`without force or coercion` — the signing is voluntary; `correction` makes no sense there." },
  { page: 30, wrong: "has red and", right: "has read and", kind: "spelling", why: "Misspelling." },
  { page: 30, wrong: "to the extend applicable", right: "to the extent applicable", kind: "spelling", why: "Misspelling." },
  { page: 31, wrong: "contract i agree", right: "contract I agree", kind: "spelling", why: "The pronoun, capitalised." },
];
