/**
 * DOT placard SVG generator. Renders a §172.519-style square-on-point (diamond) placard from an
 * explicit, cited design descriptor: background (solid / horizontal split / vertical stripes), a hazard
 * symbol, the hazard-class number in the bottom corner, and the placard wording. Colors follow the
 * standard DOT/UN placard palette. Output is a self-contained SVG string (viewBox 0 0 200 200) that
 * renders identically in a Vue web view (inline / v-html) and a React-Native app (react-native-svg).
 */

export const PALETTE = {
  red: "#E4002B",
  orange: "#FF7900",
  green: "#00843D",
  yellow: "#FEDD00",
  blue: "#0057B8",
  white: "#FFFFFF",
  black: "#0A0A0A",
} as const;

export type SymbolId =
  | "flame"
  | "cylinder"
  | "skull"
  | "trefoil"
  | "corrosive"
  | "oxidizer"
  | "explosion"
  | "none";

export type Background =
  | { kind: "solid"; color: string }
  | { kind: "split"; top: string; bottom: string }
  | { kind: "stripes"; base: string; stripe: string; region: "top" | "full" };

export interface Design {
  /** Placard wording as printed, e.g. "FLAMMABLE", "NON-FLAMMABLE GAS", or "" for none (Class 9). */
  text: string;
  /** Hazard class/division shown in the bottom corner, e.g. "3", "2", "9", "1.1"; null = none. */
  classNumber: string | null;
  background: Background;
  symbol: SymbolId;
  /** Ink color for the border. Also the default for symbol / text / number. */
  ink: string;
  /** Symbol ink (top half of a split placard); defaults to `ink`. */
  symbolInk?: string;
  /** Text + number ink (bottom half of a split placard); defaults to `ink`. */
  textInk?: string;
  /** Underline the class number (Class 9). */
  underlineNumber?: boolean;
}

// Diamond geometry (square rotated 45°): outer points and an inset inner border line.
const OUTER = "100,4 196,100 100,196 4,100";
const INNER = "100,16 184,100 100,184 16,100";

function halves(top: string, bottom: string): string {
  // top triangle and bottom triangle of the diamond, split at the horizontal diagonal
  return (
    `<polygon points="100,4 196,100 4,100" fill="${top}"/>` +
    `<polygon points="4,100 196,100 100,196" fill="${bottom}"/>`
  );
}

function stripes(base: string, stripe: string, region: "top" | "full"): string {
  // vertical stripes clipped to the diamond (top half only for Class 9 / whole for Flammable Solid)
  const clip = region === "top" ? "100,4 196,100 4,100" : OUTER;
  const bars: string[] = [];
  for (let x = 24; x <= 176; x += 22) bars.push(`<rect x="${x}" y="0" width="11" height="200" fill="${stripe}"/>`);
  return (
    `<polygon points="${OUTER}" fill="${base}"/>` +
    `<clipPath id="cl"><polygon points="${clip}"/></clipPath>` +
    `<g clip-path="url(#cl)">${bars.join("")}</g>`
  );
}

function symbolSvg(sym: SymbolId, ink: string): string {
  // symbols are drawn within a ~64×54 box centered on (100, 60)
  switch (sym) {
    case "flame":
      return `<path d="M100 30 C112 46 120 52 116 68 C124 62 124 52 122 48 C132 62 130 84 100 90 C70 84 68 62 78 48 C76 52 76 62 84 68 C80 52 90 46 100 30 Z" fill="${ink}"/>`;
    case "cylinder":
      return `<g fill="none" stroke="${ink}" stroke-width="5"><rect x="86" y="34" width="28" height="54" rx="12"/><line x1="100" y1="26" x2="100" y2="34"/><rect x="95" y="20" width="10" height="8" rx="2" fill="${ink}"/></g>`;
    case "skull":
      return `<g fill="${ink}"><path d="M100 34 C82 34 72 46 72 60 C72 70 78 74 78 80 L122 80 C122 74 128 70 128 60 C128 46 118 34 100 34 Z"/><circle cx="90" cy="58" r="6" fill="#fff"/><circle cx="110" cy="58" r="6" fill="#fff"/><rect x="94" y="66" width="4" height="8" fill="#fff"/><rect x="102" y="66" width="4" height="8" fill="#fff"/></g><g stroke="${ink}" stroke-width="6" stroke-linecap="round"><line x1="74" y1="86" x2="126" y2="100"/><line x1="126" y1="86" x2="74" y2="100"/></g>`;
    case "trefoil":
      return `<g fill="${ink}"><circle cx="100" cy="62" r="8"/><path d="M100 62 L100 30 A32 32 0 0 1 128 78 Z"/><path d="M100 62 L128 78 A32 32 0 0 1 72 78 Z"/><path d="M100 62 L72 78 A32 32 0 0 1 100 30 Z"/></g>`;
    case "corrosive":
      return `<g stroke="${ink}" stroke-width="4" fill="none"><path d="M76 34 l6 22 M96 34 l-2 22"/><path d="M70 58 l18 6 M92 60 l16 -4"/></g><g fill="${ink}"><rect x="66" y="82" width="34" height="5"/><path d="M104 82 h22 l-8 10 h-6 Z"/><circle cx="84" cy="70" r="2.5"/><circle cx="102" cy="70" r="2.5"/></g>`;
    case "oxidizer":
      return `<g fill="none" stroke="${ink}" stroke-width="5"><circle cx="100" cy="66" r="26"/></g><path d="M100 40 C108 52 114 56 111 68 C117 63 117 56 116 53 C123 63 121 80 100 84 C79 80 78 63 85 53 C84 56 84 63 89 68 C86 56 93 52 100 40 Z" fill="${ink}"/>`;
    case "explosion":
      return `<path d="M100 28 l10 22 22 -10 -12 22 22 12 -24 4 8 24 -20 -14 -20 14 8 -24 -24 -4 22 -12 -12 -22 22 10 Z" fill="${ink}"/>`;
    case "none":
      return "";
  }
}

function textBlock(text: string, ink: string): string {
  if (!text) return "";
  const words = text.split(" ");
  // stack up to 3 lines; scale font down as line count grows so long wordings still fit
  const lines: string[] = [];
  if (words.length <= 1) lines.push(text);
  else if (words.length === 2) lines.push(words[0]!, words[1]!);
  else {
    lines.push(words.slice(0, Math.ceil(words.length / 2)).join(" "));
    lines.push(words.slice(Math.ceil(words.length / 2)).join(" "));
  }
  const size = lines.length >= 2 ? 15 : 18;
  const startY = 118 + (lines.length === 1 ? 6 : 0);
  return lines
    .map(
      (ln, i) =>
        `<text x="100" y="${startY + i * (size + 2)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${size}" fill="${ink}">${escapeXml(
          ln,
        )}</text>`,
    )
    .join("");
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderPlacardSvg(d: Design): string {
  let bg: string;
  if (d.background.kind === "solid") bg = `<polygon points="${OUTER}" fill="${d.background.color}"/>`;
  else if (d.background.kind === "split") bg = halves(d.background.top, d.background.bottom);
  else bg = stripes(d.background.base, d.background.stripe, d.background.region);

  const symbolInk = d.symbolInk ?? d.ink;
  const textInk = d.textInk ?? d.ink;
  const number =
    d.classNumber != null
      ? `<text x="100" y="178" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="24" fill="${textInk}">${escapeXml(
          d.classNumber,
        )}</text>` +
        (d.underlineNumber ? `<line x1="88" y1="182" x2="112" y2="182" stroke="${textInk}" stroke-width="2.5"/>` : "")
      : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200" role="img">` +
    bg +
    `<polygon points="${OUTER}" fill="none" stroke="${d.ink}" stroke-width="3"/>` +
    `<polygon points="${INNER}" fill="none" stroke="${d.ink}" stroke-width="2"/>` +
    symbolSvg(d.symbol, symbolInk) +
    textBlock(d.text, textInk) +
    number +
    `</svg>`
  );
}
