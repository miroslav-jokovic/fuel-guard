import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import {
  checkClaims, FORMAT_SIZE, safeZone,
  type AdBrandKit, type AdBrief, type AdFormat, type AdLook, type AdOverlayLayout, type ClaimFinding, type Rect, type RenderFinding,
} from "@silvicom/shared";
import { AD_FACES, adFontBytes, canDrawAd, type AdFace } from "../../../../lib/adFonts.js";
import { inkOn, LOOKS, paletteOf, QUIET_SHARE, type LookSpec, type Palette, type TextStyle } from "./overlayLooks.js";

/**
 * Where every word and shape of an ad goes, with no picture (ADS-AD-LOOK-PLAN D-ADL3, D-ADL4; D-AD26). Whether
 * the words FIT is a fact about the words, the format, the layout and the look — the picture changes none of it —
 * so compose asks this before it pays for a picture (`overlayFit`), and `renderOverlay` paints exactly what this
 * returns, so the answer before the render and the answer at it cannot differ.
 *
 * ── TEXT FROM THE BRIEF ONLY ───────────────────────────────────────────────────────────────────────
 * Every line of copy is re-checked with `checkClaims` against the brief, here, whatever checked it before: the
 * renderer is the last thing between a figure and the picture. The claim check reads the words as WRITTEN; they
 * are drawn in capitals (the look's, not the copywriter's — copy is stored in sentence case, D-ADL4), and the
 * capitals are what `canDrawAd` is asked about. Two lines are not copy and are not claim-checked: the legal
 * line (`EEO_LINE`, D-AD9 — counsel confirms it with G12 / Q-AD8) and the kit's phone, which is the kit's own
 * data printed as stored; a phone is digits, and the claim check would read it as a figure the brief lacks.
 *
 * ── FIVE ROLES, TWO OF THEM OPTIONAL ───────────────────────────────────────────────────────────────
 * Kicker, headline, second line, call to action, legal line. An ad with only a headline and a call to action —
 * every ad until the copywriter is taught the other two — is laid out by the same rules with those rows absent.
 */

export const EEO_LINE = { en: "Equal Opportunity Employer", es: "Empleador con igualdad de oportunidades" } as const;
export type OverlayLanguage = keyof typeof EEO_LINE;

const family = (face: AdFace) => `AdsFace-${face}`;
for (const face of Object.keys(AD_FACES) as AdFace[]) GlobalFonts.register(adFontBytes(face), family(face));
export const fontOf = (s: TextStyle, u: number) => ({ font: `${s.px * u}px ${family(s.face)}`, letterSpacing: `${s.tracking * u}px` });

/** The logo's height on a frame 1080 wide, and the gap kept under it. */
export const LOGO = { height: 64, gap: 32, maxWidthShare: 0.45 } as const;
/** A chevron's width as a share of its height (`overlay.ts` draws it; the button is measured to hold it). */
export const CHEVRON = { height: 26, widthShare: 0.89, gap: 16 } as const;

export interface OverlayText {
  format: AdFormat;
  language: OverlayLanguage;
  headline: string;
  cta: string;
  /** The line above the headline — who the ad is for. Optional (D-ADL4). */
  kicker?: string | null;
  /** The second promise, under the headline. Optional (D-ADL4). */
  subline?: string | null;
  brief: Pick<AdBrief, "claims">;
  kit: Pick<AdBrandKit, "overlays"> & Partial<Pick<AdBrandKit, "colors" | "phone" | "logo">>;
  /** Where the stack sits (CQ6); absent = `bottom_plate`. */
  layout?: AdOverlayLayout;
  /** How it is drawn; absent = `rail`. */
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
  /** Words holding a digit are drawn in this colour instead (the `rail` look's headline). */
  figureColor: string | null;
  lines: LaidLine[];
  /** The box the render check judges: the row's full measure for words on the picture, the text for words on a shape. */
  box: Rect;
  needed: number;
  shape: { kind: "ribbon" | "button"; rect: Rect; fill: string; radius: number } | null;
  /** Whether what lies under the words is the picture (and so the scrim's business) or a shape of ours. */
  on: "picture" | "shape";
}
export interface Laid {
  ok: true;
  width: number; height: number; u: number;
  zone: Rect; spec: LookSpec; palette: Palette;
  rows: LaidRow[];
  /**
   * The stack's own extent — kicker to button, the full measure wide. This is the part of the picture the art
   * director was told to leave plain, so it is the band the visual check judges (`safe_zone_clear`). The footer
   * is not in it: a hairline of small print at the frame's edge, or our own band, hides nothing the picture is
   * about, and counting it would stretch a `top_band` ad's band over the whole frame.
   */
  stack: Rect;
  band: Rect | null;
  hairline: Rect | null;
  rail: Rect | null;
  logo: { x: number; y: number; height: number; maxWidth: number } | null;
  /** The vertical spans the picture is darkened across at full strength; it fades out beyond each. */
  scrim: Array<[number, number]>;
}

const ctx = createCanvas(8, 8).getContext("2d");
/**
 * One shaping per (face, size, tracking, text), remembered. Compose asks `overlayFit` for every candidate in
 * both languages on every format, and a headline is measured at up to seven rungs in every two-line split:
 * the same strings, many times. Emptied when it grows large rather than tracked for age — a process draws a
 * few hundred distinct lines, and a width does not go stale.
 */
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

export function layOut(input: OverlayText & { hasLogo: boolean }): Laid | { ok: false; findings: OverlayFinding[] } {
  const { format, language } = input;
  const overlay = input.kit.overlays[format];
  if (!overlay) return { ok: false, findings: [{ kind: "no_template", format }] };
  const spec = LOOKS[input.look ?? "rail"], palette = paletteOf(overlay, input.kit.colors);
  const layout = input.layout ?? "bottom_plate";
  const { width: W, height: H } = FORMAT_SIZE[format], u = W / 1080;
  const zone = overlay.zone ?? safeZone(format), zoneBottom = zone.y + zone.height, zoneRight = zone.x + zone.width;
  const capitals = (s: string) => s.trim().toLocaleUpperCase(language);
  const phone = input.kit.phone?.trim() || null;

  // 1. Text from the brief only, drawable by the bundled faces.
  const copy = [
    ...(input.kicker?.trim() ? [{ label: "kicker", said: input.kicker.trim() }] : []),
    { label: "headline", said: input.headline.trim() },
    ...(input.subline?.trim() ? [{ label: "subline", said: input.subline.trim() }] : []),
    { label: "cta", said: input.cta.trim() },
  ].map((c) => ({ ...c, drawn: capitals(c.said) }));
  const findings: OverlayFinding[] = [];
  for (const c of copy) for (const f of checkClaims(c.said, input.brief).findings) findings.push({ kind: "claim", label: c.label, text: f.text, claim: f.kind });
  for (const c of [...copy, { label: "eeo", drawn: EEO_LINE[language] }, ...(phone ? [{ label: "phone", drawn: phone }] : [])]) {
    const bad = [...c.drawn].find((ch) => !/\s/.test(ch) && !canDrawAd(ch));
    if (bad) findings.push({ kind: "undrawable_character", label: c.label, character: bad });
  }
  if (findings.length) return { ok: false, findings };
  const drawn = (label: string) => copy.find((c) => c.label === label)?.drawn ?? null;

  const measure = (text: string, s: TextStyle) => (text ? shaped(text, s, u).width - s.tracking * u : 0);
  const capOf = (s: TextStyle) => shaped("H", s, u).actualBoundingBoxAscent;
  const inset = spec.rail ? spec.rail.inset * u : 0, left = zone.x + inset, avail = zone.width - inset;
  const startX = (w: number) => (spec.align === "center" ? zone.x + (zone.width - w) / 2 : left);
  const overflow = (label: string, needed: number, width: number) => { if (Math.ceil(needed) > Math.floor(width)) findings.push({ kind: "overflows", label, needed_width: Math.ceil(needed), width: Math.floor(width) }); };

  // 2. The footer: the phone and the legal line, on the kit's band or on a hairline over the picture.
  const f = spec.footer, capPhone = capOf(f.phone), capEeo = capOf(f.eeo);
  const phoneW = phone ? measure(phone, f.phone) : 0, eeoW = measure(EEO_LINE[language], f.eeo);
  // A band reaches the frame's edge. Where the safe zone ends far above it (9:16), a band would be a third of
  // the frame in flat colour, so the footer goes on the hairline there, whatever the look.
  const banded = f.band !== null && palette.primary !== null && zoneBottom >= H * 0.9;
  const bandTop = banded ? zoneBottom - f.band!.height * u : 0;
  const footTall = Math.max(phone ? capPhone : 0, capEeo);
  const hairlineY = zoneBottom - footTall - 20 * u;
  const footerTop = banded ? bandTop : hairlineY;
  const footY = (cap: number) => (banded ? bandTop + (f.band!.height * u - cap) / 2 : zoneBottom - cap);
  const footColor = banded ? inkOn(palette.primary!, palette) : palette.text;
  overflow("eeo", phoneW + eeoW + (phone ? 40 * u : 0), zone.width);

  // 3. The lines with one size each.
  const kicker = drawn("kicker"), sub = drawn("subline"), cta = drawn("cta")!;
  const kickerW = kicker ? measure(kicker, spec.kicker) : 0, capKicker = capOf(spec.kicker);
  const subW = sub ? measure(sub, spec.sub) : 0, capSub = capOf(spec.sub);
  const subBoxW = subW + (spec.sub.ribbon ? 2 * spec.sub.ribbon.padX * u : 0), subH = spec.sub.ribbon ? spec.sub.ribbon.height * u : capSub;
  const ctaW = measure(cta, spec.button), capCta = capOf(spec.button), chevronW = (CHEVRON.gap + CHEVRON.height * CHEVRON.widthShare) * u;
  const buttonW = ctaW + chevronW + 2 * spec.button.padX * u, buttonH = spec.button.height * u;
  if (kicker) overflow("kicker", kickerW, avail);
  if (sub) overflow("subline", subBoxW, avail);
  overflow("cta", buttonW, avail);
  const fixedH = (kicker ? capKicker + spec.kicker.gapAfter * u : 0) + (sub ? spec.sub.gapBefore * u + subH : 0) + spec.button.gapBefore * u + buttonH;

  // 4. The headline: the first rung that holds it in two lines and keeps the stack in the plain part of the picture.
  const regionTop = zone.y + (input.hasLogo ? (LOGO.height + LOGO.gap) * u : 0), regionBottom = footerTop - f.gapBefore * u;
  const budget = Math.min(regionBottom - regionTop, H * QUIET_SHARE);
  const words = drawn("headline")!.split(/\s+/);
  const wrapAt = (px: number): { lines: string[]; widest: number } => {
    const style = { face: spec.headline.face, px, tracking: 0 }, w = (t: string) => measure(t, style), all = words.join(" ");
    if (w(all) <= avail || words.length === 1) return { lines: [all], widest: w(all) };
    const splits = words.slice(1).map((_, i) => [words.slice(0, i + 1).join(" "), words.slice(i + 1).join(" ")]);
    const best = splits.map((lines) => ({ lines, widest: Math.max(...lines.map(w)) })).sort((a, b) => a.widest - b.widest)[0]!;
    if (best.widest <= avail) return best;
    // No two lines hold it: count the lines it would take, for the finding.
    const lines: string[] = [];
    for (const word of words) { const next = lines.length ? `${lines[lines.length - 1]} ${word}` : word; if (lines.length && w(next) <= avail) lines[lines.length - 1] = next; else lines.push(word); }
    return { lines, widest: Math.max(...lines.map(w)) };
  };
  let pick: { px: number; lines: string[]; cap: number; height: number } | null = null;
  for (const px of spec.headline.ladder) {
    const { lines, widest } = wrapAt(px);
    if (lines.length > 2 || widest > avail) continue;
    const cap = capOf({ face: spec.headline.face, px, tracking: 0 });
    pick = { px, lines, cap, height: lines.length * cap + (lines.length - 1) * px * u * spec.headline.lineGap };
    if (pick.height + fixedH <= budget) break;
  }
  if (!pick) {
    const floor = wrapAt(spec.headline.ladder[spec.headline.ladder.length - 1]!);
    if (floor.lines.length > 2) findings.push({ kind: "too_long", label: "headline", lines: floor.lines.length, max_lines: 2 });
    else overflow("headline", floor.widest, avail);
  }
  const stackH = (pick?.height ?? 0) + fixedH;
  if (pick && stackH > regionBottom - regionTop) findings.push({ kind: "stack_too_tall", needed: Math.ceil(stackH), zone_height: Math.floor(regionBottom - regionTop) });
  if (findings.length || !pick) return { ok: false, findings };

  // 5. Place the rows, top to bottom.
  const stackTop = Math.round(layout === "bottom_plate" ? regionBottom - stackH : layout === "top_band" ? regionTop : regionTop + (regionBottom - regionTop - stackH) / 2);
  const rows: LaidRow[] = [];
  const measureBox = (y: number, height: number): Rect => (spec.align === "center" ? { x: zone.x, y, width: zone.width, height } : { x: left, y, width: avail, height });
  let y = stackTop;
  if (kicker) {
    rows.push({ label: "kicker", style: spec.kicker, cap: capKicker, color: spec.kicker.color === "accent" ? palette.accent : palette.text, figureColor: null, lines: [{ text: kicker, x: startX(kickerW), y, width: kickerW }], box: measureBox(y, capKicker), needed: kickerW, shape: null, on: "picture" });
    y += capKicker + spec.kicker.gapAfter * u;
  }
  const headStyle = { face: spec.headline.face, px: pick.px, tracking: 0 };
  const figures = spec.headline.figuresInAccent && palette.accent !== palette.text && words.some(hasDigit);
  rows.push({
    label: "headline", style: headStyle, cap: pick.cap, color: palette.text, figureColor: figures ? palette.accent : null,
    lines: pick.lines.map((text, i) => { const w = measure(text, headStyle); return { text, x: startX(w), y: y + i * (pick!.cap + pick!.px * u * spec.headline.lineGap), width: w }; }),
    box: measureBox(y, pick.height), needed: Math.max(...pick.lines.map((t) => measure(t, headStyle))), shape: null, on: "picture",
  });
  y += pick.height;
  const railBottom = y;
  if (sub) {
    y += spec.sub.gapBefore * u;
    const x = startX(subBoxW), textX = x + (spec.sub.ribbon ? spec.sub.ribbon.padX * u : 0), textY = y + (subH - capSub) / 2;
    const ribbon = spec.sub.ribbon ? { kind: "ribbon" as const, rect: { x, y, width: subBoxW, height: subH }, fill: palette.accent, radius: 0 } : null;
    rows.push({ label: "subline", style: spec.sub, cap: capSub, color: ribbon ? inkOn(palette.accent, palette) : palette.text, figureColor: null, lines: [{ text: sub, x: textX, y: textY, width: subW }], box: ribbon ? { x: textX, y: textY, width: subW, height: capSub } : measureBox(y, capSub), needed: subW, shape: ribbon, on: ribbon ? "shape" : "picture" });
    y += subH;
  }
  y += spec.button.gapBefore * u;
  {
    const x = startX(buttonW), fill = spec.button.fill === "accent" ? palette.accent : palette.text, textX = x + spec.button.padX * u, textY = y + (buttonH - capCta) / 2;
    rows.push({ label: "cta", style: spec.button, cap: capCta, color: inkOn(fill, palette), figureColor: null, lines: [{ text: cta, x: textX, y: textY, width: ctaW }], box: { x: textX, y: textY, width: ctaW, height: capCta }, needed: ctaW, shape: { kind: "button", rect: { x, y, width: buttonW, height: buttonH }, fill, radius: spec.button.radius === "pill" ? buttonH / 2 : spec.button.radius * u }, on: "shape" });
  }
  const stackBottom = y + buttonH;
  const foot = (label: string, text: string, s: TextStyle, cap: number, w: number, x: number): LaidRow => ({ label, style: s, cap, color: footColor, figureColor: null, lines: [{ text, x, y: footY(cap), width: w }], box: { x, y: footY(cap), width: w, height: cap }, needed: w, shape: null, on: banded ? "shape" : "picture" });
  if (phone) rows.push(foot("phone", phone, f.phone, capPhone, phoneW, zone.x));
  rows.push(foot("eeo", EEO_LINE[language], f.eeo, capEeo, eeoW, phone ? zoneRight - eeoW : zone.x));

  // The darkening ends a little under the zone, not at the frame's edge: on 9:16 the zone ends far above it,
  // and everything below is covered by the platform's own controls — a third of the frame darkened for nobody.
  const pad = 40 * u, under = zoneBottom + pad;
  const scrim: Array<[number, number]> = layout === "bottom_plate" ? [[stackTop - pad, under]]
    : [layout === "top_band" ? [0, stackBottom + pad] : [stackTop - pad, stackBottom + pad], ...(banded ? [] : [[hairlineY - pad / 2, under] as [number, number]])];
  return {
    ok: true, width: W, height: H, u, zone, spec, palette, rows, scrim, stack: measureBox(stackTop, Math.ceil(stackH)),
    band: banded ? { x: 0, y: bandTop, width: W, height: H - bandTop } : null,
    hairline: banded ? null : { x: zone.x, y: hairlineY, width: zone.width, height: 2 * u },
    rail: spec.rail ? { x: zone.x, y: stackTop, width: spec.rail.width * u, height: railBottom - stackTop } : null,
    logo: input.hasLogo ? { x: zone.x, y: zone.y, height: LOGO.height * u, maxWidth: zone.width * LOGO.maxWidthShare } : null,
  };
}
