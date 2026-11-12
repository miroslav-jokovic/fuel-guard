import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import {
  checkClaims, FORMAT_SIZE, safeZone,
  type AdBrandKit, type AdBrief, type AdFormat, type AdLook, type AdOverlayLayout, type ClaimFinding, type Rect, type RenderFinding,
} from "@silvicom/shared";
import { AD_FACES, adFontBytes, canDrawAd, type AdFace } from "../../../../lib/adFonts.js";
import { LOOKS, paletteOf, QUIET_SHARE, type LookSpec, type Palette, type TextStyle } from "./overlayLooks.js";

/**
 * Where every word and shape of an ad goes, with no picture (ADS-AD-LOOK-PLAN D-ADL3, D-ADL16–19; D-AD26). Whether
 * the words FIT is a fact about the words, the format, the layout and the look — the picture changes none of it —
 * so compose asks this before it pays for a picture (`overlayFit`), and `renderOverlay` paints exactly what this
 * returns, so the answer before the render and the answer at it cannot differ.
 *
 * ── TEXT FROM THE BRIEF ONLY ───────────────────────────────────────────────────────────────────────
 * Every line of copy is re-checked with `checkClaims` against the brief, here, whatever checked it before: the
 * renderer is the last thing between a figure and the picture. The call to action is checked too though no look
 * draws it (D-ADL19): it is still the creative's copy. The headline is drawn in capitals, the supporting line as
 * written; what is DRAWN is what `canDrawAd` is asked about. The legal line (`EEO_LINE`, D-AD9) and the kit's phone
 * are not copy and are not claim-checked: a phone is digits, and the claim check would read it as a figure.
 *
 * ── WHAT IS DRAWN ──────────────────────────────────────────────────────────────────────────────────
 * The headline; one supporting line (the second line, or the kicker when the preset has no second line — a label
 * above the headline is a banned device, D-ADL17); the logo, top-left; the legal line, and the kit's phone beside
 * it. `number` falls back to `field` when its headline does not open with a figure or its figure leaves no room,
 * and the band looks fall back to `photo` for a kit with no colour a band could be. The look actually drawn is
 * returned (`Laid.look`), so a reviewer is never told one look and shown another.
 */

export const EEO_LINE = { en: "Equal Opportunity Employer", es: "Empleador con igualdad de oportunidades" } as const;
export type OverlayLanguage = keyof typeof EEO_LINE;

const family = (face: AdFace) => `AdsFace-${face}`;
for (const face of Object.keys(AD_FACES) as AdFace[]) GlobalFonts.register(adFontBytes(face), family(face));
export const fontOf = (s: TextStyle, u: number) => ({ font: `${s.px * u}px ${family(s.face)}`, letterSpacing: `${s.tracking * u}px` });

/** The logo's height on a frame 1080 wide (about a sixteenth of a 4:5 frame, the brand skill's floor with its clear space), and the gap kept under it. */
export const LOGO = { height: 84, gap: 36, maxWidthShare: 0.5 } as const;

export interface OverlayText {
  format: AdFormat;
  language: OverlayLanguage;
  headline: string;
  /** Claim-checked, never drawn (D-ADL19). */
  cta: string;
  /** Drawn as the supporting line only when there is no `subline` (D-ADL17). */
  kicker?: string | null;
  /** The supporting line under the headline. */
  subline?: string | null;
  brief: Pick<AdBrief, "claims">;
  kit: Pick<AdBrandKit, "overlays"> & Partial<Pick<AdBrandKit, "colors" | "phone" | "logo">>;
  /** Which edge the words sit against (CQ6); absent = `bottom_plate`. A band look draws its band on that edge; `centered` is the bottom. */
  layout?: AdOverlayLayout;
  /** How it is drawn; absent = `field`. */
  look?: AdLook;
}

export type OverlayFinding =
  | RenderFinding
  | { kind: "no_template"; format: AdFormat }
  | { kind: "too_long"; label: string; lines: number; max_lines: number }
  | { kind: "stack_too_tall"; needed: number; zone_height: number }
  | { kind: "undrawable_character"; label: string; character: string }
  | ({ kind: "claim"; label: string } & Pick<ClaimFinding, "text"> & { claim: ClaimFinding["kind"] });

export interface LaidLine { text: string; x: number; y: number; width: number }
export interface LaidRow {
  label: string;
  style: TextStyle;
  /** Height of a capital at this size: lines are placed by their cap top, so a stack is as tall as it looks. */
  cap: number;
  color: string;
  /** Words holding a digit are drawn in this colour instead (`field`'s headline). */
  figureColor: string | null;
  lines: LaidLine[];
  /** The box the render check judges. */
  box: Rect;
  needed: number;
  /** Whether what lies under the words is the picture (and so the scrim's business) or our band. */
  on: "picture" | "band";
}
export interface Laid {
  ok: true;
  width: number; height: number; u: number;
  /** The look drawn, after the fallbacks above. */
  look: AdLook;
  zone: Rect; spec: LookSpec; palette: Palette;
  rows: LaidRow[];
  /** Headline to supporting line, the full measure wide: the words' part of the frame, which the visual check judges. */
  stack: Rect;
  /** The solid band and its colour, for `field` and `number`. */
  band: (Rect & { fill: string }) | null;
  logo: { x: number; y: number; height: number; maxWidth: number } | null;
  /** `photo`'s vertical spans darkened at full strength; it eases out beyond each. Empty for a band. */
  scrim: Array<[number, number]>;
}
type Refused = { ok: false; findings: OverlayFinding[] };

const ctx = createCanvas(8, 8).getContext("2d");
/** One shaping per (face, size, tracking, text), remembered: compose asks for every candidate on every format. */
const widths = new Map<string, { width: number; actualBoundingBoxAscent: number }>();
function shaped(text: string, s: TextStyle, u: number): { width: number; actualBoundingBoxAscent: number } {
  const key = `${s.face}|${s.px * u}|${s.tracking * u}|${text}`;
  let m = widths.get(key);
  if (!m) {
    Object.assign(ctx, fontOf(s, u));
    const t = ctx.measureText(text);
    m = { width: t.width, actualBoundingBoxAscent: t.actualBoundingBoxAscent };
    if (widths.size > 20_000) widths.clear();
    widths.set(key, m);
  }
  return m;
}
const hasDigit = (word: string) => /\d/.test(word);
/**
 * `number`'s figure: the money or count a headline OPENS with, without what is glued to it ("$0.68" of
 * "$0.68/MILE,", "70¢", "$28–$32"). What follows it in the same word stays in the words beside it, so the
 * headline still reads in order: "$0.68" then "/MILE, HOME WEEKLY".
 */
const FIGURE = /^[$€£]?\d[\d.,]*(?:[–-][$€£]?\d[\d.,]*)?[¢%K]?/;
const display = (px: number): TextStyle => ({ face: "display", px, tracking: 0 });

export function layOut(input: OverlayText & { hasLogo: boolean }): Laid | Refused {
  const overlay = input.kit.overlays[input.format];
  if (!overlay) return { ok: false, findings: [{ kind: "no_template", format: input.format }] };
  const palette = paletteOf(overlay, input.kit.colors);
  const bandFill = palette.ground ?? palette.primary;
  let look: AdLook = input.look ?? "field";
  if (look !== "photo" && bandFill === null) look = "photo";
  const words = input.headline.trim().toLocaleUpperCase(input.language).split(/\s+/);
  if (look === "number" && !FIGURE.test(words[0] ?? "")) look = "field";
  const laid = place(input, look, palette, bandFill);
  // A figure too wide to leave its words a column is drawn as the band it would have been on.
  return !laid.ok && look === "number" && laid.findings.every((f) => f.kind !== "claim" && f.kind !== "undrawable_character") ? place(input, "field", palette, bandFill) : laid;
}

function place(input: OverlayText & { hasLogo: boolean }, look: AdLook, palette: Palette, bandFill: string | null): Laid | Refused {
  const { format, language } = input;
  const spec = LOOKS[look], layout = input.layout ?? "bottom_plate", onBand = spec.ground === "band";
  const atTop = layout === "top_band";
  const { width: W, height: H } = FORMAT_SIZE[format], u = W / 1080;
  const zone = input.kit.overlays[format]!.zone ?? safeZone(format), zoneBottom = zone.y + zone.height, zoneRight = zone.x + zone.width;
  const phone = input.kit.phone?.trim() || null;
  const support = input.subline?.trim() ? { label: "subline", said: input.subline.trim() } : input.kicker?.trim() ? { label: "kicker", said: input.kicker.trim() } : null;

  // 1. Text from the brief only; what is drawn, drawable by the bundled faces.
  const findings: OverlayFinding[] = [];
  const said = [
    ...(input.kicker?.trim() ? [{ label: "kicker", said: input.kicker.trim() }] : []),
    { label: "headline", said: input.headline.trim() },
    ...(input.subline?.trim() ? [{ label: "subline", said: input.subline.trim() }] : []),
    { label: "cta", said: input.cta.trim() },
  ];
  for (const c of said) for (const f of checkClaims(c.said, input.brief).findings) findings.push({ kind: "claim", label: c.label, text: f.text, claim: f.kind });
  const headline = input.headline.trim().toLocaleUpperCase(language);
  for (const c of [{ label: "headline", drawn: headline }, ...(support ? [{ label: support.label, drawn: support.said }] : []), { label: "eeo", drawn: EEO_LINE[language] }, ...(phone ? [{ label: "phone", drawn: phone }] : [])]) {
    const bad = [...c.drawn].find((ch) => !/\s/.test(ch) && !canDrawAd(ch));
    if (bad) findings.push({ kind: "undrawable_character", label: c.label, character: bad });
  }
  if (findings.length) return { ok: false, findings };

  const measure = (text: string, s: TextStyle) => (text ? shaped(text, s, u).width - s.tracking * u : 0);
  const capOf = (s: TextStyle) => shaped("H", s, u).actualBoundingBoxAscent;
  const overflow = (label: string, needed: number, width: number) => { if (Math.ceil(needed) > Math.floor(width)) findings.push({ kind: "overflows", label, needed_width: Math.ceil(needed), width: Math.floor(width) }); };
  const left = zone.x, avail = zone.width;

  // 2. The lines with one size: the supporting line and the footer (the legal line, the phone at the right).
  const f = spec.footer, capPhone = capOf(f.phone), capEeo = capOf(f.eeo), footH = Math.max(phone ? capPhone : 0, capEeo);
  const phoneW = phone ? measure(phone, f.phone) : 0, eeoW = measure(EEO_LINE[language], f.eeo);
  overflow("eeo", phoneW + eeoW + (phone ? 40 * u : 0), zone.width);
  const subW = support ? measure(support.said, spec.sub) : 0, capSub = capOf(spec.sub);
  const subBlock = support ? spec.sub.gapBefore * u + capSub : 0;

  // 3. The headline: the first rung that holds it in two lines within `width` and keeps the words in the budget.
  const wrapAt = (ws: string[], px: number, width: number): { lines: string[]; widest: number } => {
    const style = display(px), w = (t: string) => measure(t, style), all = ws.join(" ");
    if (!ws.length) return { lines: [], widest: 0 };
    if (w(all) <= width || ws.length === 1) return { lines: [all], widest: w(all) };
    const best = ws.slice(1).map((_, i) => [ws.slice(0, i + 1).join(" "), ws.slice(i + 1).join(" ")])
      .map((lines) => ({ lines, widest: Math.max(...lines.map(w)) })).sort((a, b) => a.widest - b.widest)[0]!;
    if (best.widest <= width) return best;
    const lines: string[] = [];
    for (const word of ws) { const next = lines.length ? `${lines[lines.length - 1]} ${word}` : word; if (lines.length && w(next) <= width) lines[lines.length - 1] = next; else lines.push(word); }
    return { lines, widest: Math.max(...lines.map(w)) };
  };
  const heightOf = (n: number, px: number) => (n ? n * capOf(display(px)) + (n - 1) * px * u * spec.headline.lineGap : 0);
  const logoRoom = input.hasLogo ? (LOGO.height + LOGO.gap) * u : 0;
  const regionTop = zone.y + logoRoom, footTop = zoneBottom - footH, regionBottom = footTop - f.gapBefore * u;
  const budget = Math.min(regionBottom - regionTop, H * QUIET_SHARE);
  const words = headline.split(/\s+/);

  type Pick = { rows: (top: number) => LaidRow[]; height: number; px: number };
  let pick: Pick | null = null;
  if (spec.figure) {
    // `number`: the opening figure at its own rung, the rest of the headline and the supporting line in a column
    // beside it, cap tops on one line, the supporting line's baseline on the figure's.
    const fig = words[0]!.match(FIGURE)![0].replace(/[.,]$/, ""), glued = words[0]!.slice(fig.length), rest = [...(glued ? [glued] : []), ...words.slice(1)];
    for (const fpx of spec.figure.ladder) {
      const fs = display(fpx), figW = measure(fig, fs), figCap = capOf(fs), colX = left + figW + spec.figure.gap * u, colW = zoneRight - colX;
      if (colW < 160 * u || subW > colW) continue;
      const rpx = Math.max(Math.round(fpx * spec.figure.restShare), spec.figure.restMin), r = wrapAt(rest, rpx, colW);
      if (r.lines.length > 2 || r.widest > colW) continue;
      const colH = heightOf(r.lines.length, rpx) + (support ? (r.lines.length ? spec.sub.gapBefore * u : 0) + capSub : 0);
      if (colH > figCap || figCap > budget) continue;
      const rs = display(rpx), rCap = capOf(rs);
      pick = { px: fpx, height: figCap, rows: (top) => [
        { label: "headline_figure", style: fs, cap: figCap, color: palette.accent, figureColor: null, lines: [{ text: fig, x: left, y: top, width: figW }], box: { x: left, y: top, width: figW, height: figCap }, needed: figW, on: "band" },
        ...(r.lines.length ? [{ label: "headline", style: rs, cap: rCap, color: palette.text, figureColor: null, lines: r.lines.map((text, i) => ({ text, x: colX, y: top + i * (rCap + rpx * u * spec.headline.lineGap), width: measure(text, rs) })), box: { x: colX, y: top, width: colW, height: heightOf(r.lines.length, rpx) }, needed: r.widest, on: "band" as const }] : []),
        ...(support ? [{ label: support.label, style: spec.sub, cap: capSub, color: palette.text, figureColor: null, lines: [{ text: support.said, x: colX, y: top + figCap - capSub, width: subW }], box: { x: colX, y: top + figCap - capSub, width: colW, height: capSub }, needed: subW, on: "band" as const }] : []),
      ] };
      break;
    }
    if (!pick) return { ok: false, findings: [{ kind: "overflows", label: "headline_figure", needed_width: Math.ceil(measure(fig, display(spec.figure.ladder.at(-1)!))), width: Math.floor(avail) }] };
  } else {
    if (support) overflow(support.label, subW, avail);
    let fitting: { px: number; lines: string[] } | null = null;
    for (const px of spec.headline.ladder) {
      const { lines, widest } = wrapAt(words, px, avail);
      if (lines.length > 2 || widest > avail) continue;
      fitting = { px, lines };
      if (heightOf(lines.length, px) + subBlock <= budget) break;
    }
    if (!fitting) {
      const floor = wrapAt(words, spec.headline.ladder.at(-1)!, avail);
      if (floor.lines.length > 2) findings.push({ kind: "too_long", label: "headline", lines: floor.lines.length, max_lines: 2 });
      else overflow("headline", floor.widest, avail);
      return { ok: false, findings };
    }
    const { px, lines } = fitting, hs = display(px), cap = capOf(hs), headH = heightOf(lines.length, px), on = onBand ? "band" as const : "picture" as const;
    const figures = spec.headline.figuresInAccent && palette.accent !== palette.text && words.some(hasDigit);
    pick = { px, height: headH + subBlock, rows: (top) => [
      { label: "headline", style: hs, cap, color: palette.text, figureColor: figures ? palette.accent : null, lines: lines.map((text, i) => ({ text, x: left, y: top + i * (cap + px * u * spec.headline.lineGap), width: measure(text, hs) })), box: { x: left, y: top, width: avail, height: headH }, needed: Math.max(...lines.map((t) => measure(t, hs))), on },
      ...(support ? [{ label: support.label, style: spec.sub, cap: capSub, color: palette.text, figureColor: null, lines: [{ text: support.said, x: left, y: top + headH + spec.sub.gapBefore * u, width: subW }], box: { x: left, y: top + headH + spec.sub.gapBefore * u, width: avail, height: capSub }, needed: subW, on }] : []),
    ] };
  }
  if (pick.height > regionBottom - regionTop) findings.push({ kind: "stack_too_tall", needed: Math.ceil(pick.height), zone_height: Math.floor(regionBottom - regionTop) });
  if (findings.length) return { ok: false, findings };

  // 4. Place. A band sits on the layout's edge and holds everything; `photo` places the stack as the layout says
  //    and the footer at the zone's foot.
  const pad = spec.band ? spec.band.padTop * u : 0;
  let stackTop: number, band: Laid["band"] = null, footY = (cap: number) => footTop + (footH - cap);
  if (spec.band && atTop) {
    stackTop = Math.round(regionTop);
    const footAt = stackTop + pick.height + f.gapBefore * u;
    footY = (cap) => footAt + (footH - cap);
    band = { x: 0, y: 0, width: W, height: Math.max(H * spec.band.minShare, footAt + footH + pad), fill: bandFill! };
  } else if (spec.band) {
    const top = Math.min(H * (1 - spec.band.minShare), regionBottom - pick.height - pad);
    stackTop = Math.round(top + pad);
    band = { x: 0, y: top, width: W, height: H - top, fill: bandFill! };
  } else {
    stackTop = Math.round(layout === "bottom_plate" ? regionBottom - pick.height : atTop ? regionTop : regionTop + (regionBottom - regionTop - pick.height) / 2);
  }
  const footOn = band ? "band" as const : "picture" as const;
  const foot = (label: string, text: string, s: TextStyle, cap: number, w: number, x: number): LaidRow => ({ label, style: s, cap, color: palette.text, figureColor: null, lines: [{ text, x, y: footY(cap), width: w }], box: { x, y: footY(cap), width: w, height: cap }, needed: w, on: footOn });
  const rows = [...pick.rows(stackTop), foot("eeo", EEO_LINE[language], f.eeo, capEeo, eeoW, zone.x), ...(phone ? [foot("phone", phone, f.phone, capPhone, phoneW, zoneRight - phoneW)] : [])];

  // `photo`'s darkening ends a little under the zone, not at the frame's edge: on 9:16 everything below the zone is
  // covered by the platform's own controls.
  const sp = 40 * u, under = zoneBottom + sp, stackBottom = stackTop + pick.height;
  const scrim: Laid["scrim"] = band ? [] : layout === "bottom_plate" ? [[stackTop - sp, under]] : [[stackTop - sp, stackBottom + sp], [footTop - sp / 2, under]];
  return {
    ok: true, width: W, height: H, u, look, zone, spec, palette, rows, scrim, band,
    stack: { x: left, y: stackTop, width: avail, height: Math.ceil(pick.height) },
    logo: input.hasLogo ? { x: zone.x, y: zone.y, height: LOGO.height * u, maxWidth: zone.width * LOGO.maxWidthShare } : null,
  };
}
