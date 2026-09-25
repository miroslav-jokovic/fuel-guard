/**
 * Folding text into WinAnsi, which is all the PDF standard fonts can encode.
 *
 * ── WHY ITS OWN MODULE (AUD-21, 2026-09-20) ───────────────────────────────────────────────────
 * Split out of `pdfDraw.ts` when that file hit 501 lines against a 500-line budget, and this is the
 * seam rather than an arbitrary cut: it is pure string logic with no pdfkit type in it, it has its
 * own test file, and the two things it answers — what this encoding can hold, and what a reader
 * should see when it cannot — are a subject of their own. The AUD-8 and AUD-9 entries in
 * `HIRING-MODULE-PLAN.md` §10 each said the split was owed; AUD-21's comment is what finally made
 * the gate say so.
 *
 * ⚠ `pdfDraw.ts` re-exports it, so no call site moved. Every drawing helper there folds through it
 * and the three modules that call it directly keep the import they had.
 */

/**
 * Fold text into WinAnsi, which is all the PDF standard fonts can encode.
 *
 * THIS IS A REAL COMPROMISE AND IT IS DELIBERATE. Both pdfkit's built-in Helvetica and pdf-lib's
 * StandardFonts are WinAnsi; handed a name like "Nikolić" they THROW rather than degrade, which
 * would fail the whole binder over one driver's surname. The alternatives are worse: shipping a
 * Unicode TTF adds a font binary and a licence to the repository for a handful of glyphs, and
 * dropping the characters silently would print "Nikoli".
 *
 * So Latin letters lose their diacritics — the form every DOT document a US carrier files already
 * uses — and anything genuinely unrepresentable becomes '?', which reads as a defect rather than as
 * a different person's name. Applied inside every helper below, so no drawing path can skip it.
 *
 * ── ⚠ ONLY WHAT WINANSI CANNOT HOLD IS FOLDED, AND IT USED TO BE EVERYTHING (AUD-3, 2026-09-19) ─
 * The paragraph above is about `ć` and `š`, which genuinely are outside the encoding. But the strip ran
 * unconditionally, so `é` and `ñ` — both of which ARE WinAnsi (0xE9, 0xF1), and both of which every
 * standard font reached from here draws — were decomposed and flattened along with them. A driver
 * named José Muñoz-Peña had `Jose Munoz-Pena` filed as their §391.21 application.
 *
 * ⚠ **The packet proved it, by disagreeing.** `packetOverlay.ts` draws through pdf-lib and does not
 * call this function at all; on the same run that this function flattened the name onto the summary,
 * the overlay printed it correctly onto the carrier's page 3. Two documents in one qualification
 * file spelling one driver's name two ways, and the one that was right was the one with no
 * normaliser — which settles whether the fold was ever needed for Latin-1. It was not.
 *
 * So the decomposition is applied PER CHARACTER, and only to characters the encoding cannot hold.
 * `ć` still becomes `c` and `š` still becomes `s`; `é` and `ñ` are left alone; and the catch-all at the
 * bottom still turns anything that survives and is genuinely unrepresentable into '?'.
  *
 * ── ⚠ SUPERSEDED FOR OUR OWN DOCUMENTS (Q-AF2, 2026-09-25) ────────────────────────────────────
 * The "handful of glyphs" above was measured, for this carrier, as every Serbian and Polish surname:
 * pdf-lib threw on `ć` and the packet never filed. `pdfFonts.ts` now embeds Liberation Sans in every
 * document `newDrawing` makes and in the packet, and `pdfkitText` keeps the name as typed. This fold
 * remains for any document made WITHOUT the face, and one character at a time for what the face
 * itself cannot draw.
 */

export function winAnsi(text: string): string {
  return text
    // ⚠ **U+000A is the ONE control character this function keeps, and the catch-all below used to
    // eat it (AUD-21, 2026-09-20).** pdfkit honours a newline in `text()` as a line break and
    // `heightOfString` measures one, so a break that survives to here renders as a break. It did not
    // survive: `\n` is outside WinAnsi's printable range, so it fell through to the '?' at the
    // bottom. The 15 U.S.C. 7001(c) consent is composed by `esignConsentBody()` with **16** of them
    // — a label and its clause, then a blank line, six times over — and all 16 printed as '?' on a
    // document that gets FILED. The source carries no '?' of its own, so every one a reader saw was
    // corruption: *"You can have these on paper instead?You do not have to do any of this
    // electronically."*
    //
    // ⚠ **The screen had it right the whole time, which is how this stayed invisible.**
    // `EsignConsentGate.vue` renders the same stored string under `whitespace-pre-line`, with a
    // comment saying *"because the clauses are composed with their own line breaks"*. The applicant
    // read a correctly broken consent, signed it, and the filed PDF of that same consent printed
    // run-on prose. A2's defect exactly — one document, two renderers, disagreeing.
    //
    // CRLF first, so the carriage return is gone before anything can fold it to '?'. It is not
    // hypothetical: `carrierWording.ts` stores carrier-authored clause text and an HTML textarea
    // submits CRLF by specification. (No web surface writes that wording yet — the API door does.)
    .replace(/\r\n?/g, "\n")
    // A tab means nothing to pdfkit — there are no tab stops to honour — but '?' is corruption
    // where a space is merely a space.
    .replace(/\t/g, " ")
    // ⚠ NOT a bare `.normalize("NFD")` over the whole string. NFD decomposes every precomposed Latin
    // letter, WinAnsi or not, and the combining-mark strip cannot tell the two apart afterwards —
    // which is exactly how a Spanish surname came to be folded by a rule written for a Serbian one.
    // The class here is the same one the '?' catch-all at the bottom uses, deliberately: what may
    // stay and what must be folded are then one definition rather than two that can drift.
    .replace(/[^\n\u0020-\u007e\u00a0-\u00ff]/gu, (ch) =>
      ch.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
    .replace(/\u0110/g, "D")
    .replace(/\u0111/g, "d") // D-with-stroke carries no combining mark
    .replace(/\u0141/g, "L")
    .replace(/\u0142/g, "l") // L-with-stroke likewise
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    // U+2013/U+2014 are the dashes prose uses; U+2010-U+2012, U+2015 and U+2212 are the ones GENERATED
    // copy uses — a formatted negative number carries a true minus (U+2212), and "-88.1% vs prior" was
    // reaching a boss's PDF as "?88.1% vs prior", which reads as corruption rather than as a minus.
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    // U+2192 reaches here from GENERATED copy, not from prose: `operatingBridge` builds its withheld
    // messages as "Fleet MPG of 12.7 for 2026-08-17 \u2192 2026-08-23 is outside what a tractor can do",
    // and with no rule for it the arrow fell through to the '?' catch-all below. A boss's PDF read
    // "2026-08-17 ? 2026-08-23", which is the corruption this whole function exists to avoid printing.
    .replace(/\u2192/g, "-")
    .replace(/\u2190/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u2022/g, "\u00b7")
    .replace(/[^\n\u0020-\u007e\u00a0-\u00ff]/g, "?");
}
