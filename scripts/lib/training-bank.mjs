/**
 * The driver safety-training question bank, read from where it is written: §5 of
 * `docs/plans/training/SEGMENT-QUIZ-2026-11-25.md` (D-TR13–D-TR17). The loader
 * (`scripts/training-load.mjs`) enters what this returns through the office API, so the document stays
 * the one source: a corrected question is corrected in the document and loaded again, never typed into
 * a second copy ("deriving beats restating", root CLAUDE.md).
 *
 * The format is §5's own: a `### Film 0N · Title` heading, `**Stop N · Title (m:ss–m:ss)**`, then per
 * point `*Point N: …*`, an `- **A.**` and a `- **B.**` question, each followed by a `✓ right · wrong ·
 * wrong · wrong` line, and one `- *Why:*` line shared by both versions. Anything that does not fit is an
 * error with its line number, because a question that silently drops out leaves a stop unpublishable
 * (`publishBlockers`) or, worse, a stop asking two points instead of three.
 */

const FILM = /^### Film (\d{2}) · (.+)$/;
const STOP = /^\*\*Stop (\d) · (.+) \((\d+:\d{2})–(\d+:\d{2})\)\*\*$/;
const POINT = /^\*Point (\d): (.+)\* \(([\d:–]+)\)$/;
const VERSION = /^- \*\*([AB])\.\*\* (.+)$/;
const CHOICES = /^ {2}✓ (.+)$/;
const WHY = /^- \*Why:\* (.+)$/;

/** "1:26" → 86000. */
export const clockMs = (s) => {
  const [m, sec] = s.split(":").map(Number);
  return (m * 60 + sec) * 1000;
};

/**
 * Parse §5 into films → stops → points → two versions. Throws on the first line that breaks the format,
 * and on a bank that breaks the rules of §3.5 / D-TR14 (3 points a stop, 2 versions a point, 4 answers).
 */
export function parseBank(markdown) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.startsWith("## 5. "));
  if (start < 0) throw new Error("§5 (the question bank) not found");
  const films = [];
  let film = null;
  let stop = null;
  let point = null;
  let pendingVersion = null;
  const where = (i) => `SEGMENT-QUIZ line ${i + 1}`;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## ")) break;
    let m;
    if ((m = FILM.exec(line))) {
      film = { no: Number(m[1]), title: m[2].trim(), stops: [] };
      films.push(film);
      stop = point = null;
    } else if ((m = STOP.exec(line))) {
      if (!film) throw new Error(`${where(i)}: a stop before any film`);
      stop = { no: Number(m[1]), title: m[2].trim(), startMs: clockMs(m[3]), endMs: clockMs(m[4]), points: [] };
      film.stops.push(stop);
      point = null;
    } else if ((m = POINT.exec(line))) {
      if (!stop) throw new Error(`${where(i)}: a point before any stop`);
      point = { no: Number(m[1]), summary: m[2].trim(), versions: [], why: null };
      stop.points.push(point);
    } else if ((m = VERSION.exec(line))) {
      if (!point) throw new Error(`${where(i)}: a question before any point`);
      pendingVersion = { label: m[1], prompt: m[2].trim(), line: i + 1 };
    } else if ((m = CHOICES.exec(line))) {
      if (!pendingVersion) throw new Error(`${where(i)}: answers with no question above them`);
      const choices = m[1].split(" · ").map((c) => c.trim());
      point.versions.push({ ...pendingVersion, choices });
      pendingVersion = null;
    } else if ((m = WHY.exec(line))) {
      if (!point) throw new Error(`${where(i)}: a reason before any point`);
      point.why = m[1].trim();
    } else if (pendingVersion && line.trim()) {
      throw new Error(`${where(i)}: expected the "✓ right · wrong · …" line under question ${pendingVersion.label}`);
    }
  }
  checkBank(films);
  return films;
}

function checkBank(films) {
  const errors = [];
  if (films.length !== 5) errors.push(`expected films 01–05, found ${films.length}`);
  for (const f of films) {
    const name = `Film ${String(f.no).padStart(2, "0")}`;
    // D-TR17: film 03's second part joins its third, so it stops twice; every other film stops 3 times.
    const stops = f.no === 3 ? 2 : 3;
    if (f.stops.length !== stops) errors.push(`${name}: ${f.stops.length} stops, expected ${stops}`);
    for (const s of f.stops) {
      if (s.points.length !== 3) errors.push(`${name} stop ${s.no}: ${s.points.length} points, expected 3 (D-TR14)`);
      for (const p of s.points) {
        const at = `${name} stop ${s.no} point ${p.no}`;
        if (p.versions.map((v) => v.label).join("") !== "AB") errors.push(`${at}: versions ${p.versions.map((v) => v.label).join("") || "none"}, expected A and B (D-TR15)`);
        if (!p.why) errors.push(`${at}: no "Why" line`);
        for (const v of p.versions) {
          if (v.choices.length !== 4) errors.push(`${at}${v.label} (line ${v.line}): ${v.choices.length} answers, expected 4 (§3.5)`);
          if (new Set(v.choices.map((c) => c.toLowerCase())).size !== v.choices.length) errors.push(`${at}${v.label}: two answers are the same`);
        }
      }
    }
  }
  if (errors.length) throw new Error(`The question bank breaks its own rules:\n  ${errors.join("\n  ")}`);
}

/**
 * A film's chapters as the player takes them (§2): an Opening with no questions (0:00, the title card),
 * one chapter per stop, and a Closing with no questions, so the last stop pauses before the card.
 * `closingMs` is the last stop's end, which §2 measured as the closing card's start.
 */
export function chaptersOf(film) {
  const last = film.stops[film.stops.length - 1];
  return [
    { title: "Opening", startMs: 0 },
    ...film.stops.map((s) => ({ title: s.title, startMs: s.startMs })),
    { title: "Closing", startMs: last.endMs },
  ];
}

/**
 * The bank's questions as the office API's `trainingQuestionSchema` takes them. Chapter 0 is the
 * Opening, so stop N is chapter N; point N is stored 0-based. §5 writes the right answer first, and the
 * driver's page shuffles every answer list it shows (D-TR15), so answerIndex 0 is never what a driver sees.
 */
export function questionsOf(film) {
  return film.stops.flatMap((s) =>
    s.points.flatMap((p) =>
      p.versions.map((v) => ({ chapter: s.no, point: p.no - 1, prompt: v.prompt, choices: v.choices, answerIndex: 0, why: p.why })),
    ),
  );
}
