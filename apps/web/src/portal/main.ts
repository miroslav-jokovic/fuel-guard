import "virtual:portal-tokens.css";
import "./portal.css";
import type { TrainingAnswerFeedback, TrainingPortalFilm, TrainingPortalHome, TrainingPortalQuiz } from "@silvicom/shared";
import { createApi, LinkError, type PortalApi } from "./api";
import { allowedSeek, clock, megabytes, pickHeight, type ConnectionHint, type DataMode } from "./signal";

/**
 * The driver's safety-training page, `/t/:token` (SAFETY-VIDEOS-AND-QUIZZES-ANALYSIS §8–§9, D-TR2/4/7/8).
 *
 * ── WHY THIS IS NOT THE MAIN APP ───────────────────────────────────────────────────────────────
 * A driver taps a text on a truck-stop's edge of coverage. The office app's first load is the router,
 * the query client, the Supabase client and the design system — far past D-TR12's budget. This page is
 * its own Vite entry (`t.html`): plain TypeScript, the design system's colour tokens, the phone's own
 * fonts, and nothing else. `lint:training-page` holds it under budget.
 *
 * The flow (SEGMENT-QUIZ D-TR13–D-TR15): list → film, which pauses at the end of each segment → that
 * segment's questions, all right to go on (the reason after a right answer, nothing after a wrong one)
 * → on with the film, or the segment again and the other version of what was missed.
 */

const app = document.getElementById("app")!;
const token = location.pathname.split("/").filter(Boolean)[1] ?? "";
const api: PortalApi = createApi(token);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const conn = (): ConnectionHint | null => (navigator as Navigator & { connection?: ConnectionHint }).connection ?? null;
const dataMode = (): DataMode => (localStorage.getItem("training:data") === "low" ? "low" : "normal");

let home: TrainingPortalHome | null = null;
let stopFilm: (() => void) | null = null;

function render(html: string): void {
  stopFilm?.();
  stopFilm = null;
  app.innerHTML = `<header class="top"><span class="co">${esc(home?.carrier ?? "")}</span><span class="sig" id="sig" role="status"></span></header><main class="body">${html}</main>`;
  showSignal();
  window.scrollTo(0, 0);
}

function showSignal(): void {
  const el = document.getElementById("sig");
  if (!el) return;
  const waiting = api.pending();
  if (!navigator.onLine) {
    el.className = "sig off";
    el.textContent = "No signal · saved on phone";
  } else if (waiting) {
    el.className = "sig weak";
    el.textContent = "Sending saved work…";
  } else {
    el.className = "sig";
    el.textContent = dataMode() === "low" ? "Low data" : "";
  }
}

function problem(e: unknown): void {
  const msg = e instanceof LinkError ? e.message : "No signal right now. Your work is saved; open the link again when you have signal.";
  render(`<p class="lead" data-test="problem">${esc(msg)}</p>`);
}

const STATUS: Record<string, string> = { locked: "🔒 After the video before", watch: "▶ Start", rewatch: "↺ Watch a part again", quiz: "✎ Questions waiting", passed: "✓ Passed" };

async function showHome(): Promise<void> {
  try {
    home = await api.home();
  } catch (e) {
    return problem(e);
  }
  const h = home;
  const done = h.lessons.filter((l) => l.status === "passed").length;
  const pct = h.lessons.length ? Math.round((done / h.lessons.length) * 100) : 0;
  const minutes = Math.round(h.lessons.reduce((t, l) => t + l.durationMs, 0) / 60000);
  render(`
    <h1>${h.firstName ? `Hi ${esc(h.firstName)}` : "Your safety videos"}</h1>
    <p class="lead">${esc(h.courseTitle)}: ${h.lessons.length} ${h.lessons.length === 1 ? "video" : "videos"}, about ${minutes} min. A short quiz follows each one.
      ${h.dueOn ? `<b>Finish by ${esc(h.dueOn)}.</b>` : ""} Only watch when you're parked.</p>
    <div class="bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
    <p class="small">${h.complete ? "<b>All done. Thank you.</b>" : `${done} of ${h.lessons.length} done`}</p>
    ${h.lessons
      .map(
        (l, i) => `<button class="lesson" data-v="${esc(l.versionId)}" ${l.status === "locked" ? "disabled" : ""}>
          <img src="${esc(l.posterUrl)}" alt="" width="92" height="52" loading="lazy">
          <span><span class="t">${i + 1}. ${esc(l.title)}</span><br><span class="m">${clock(l.durationMs)} · ${STATUS[l.status] ?? ""}</span></span>
        </button>`,
      )
      .join("")}
    <label class="mode"><input type="checkbox" id="low" ${dataMode() === "low" ? "checked" : ""}> Low data: smaller videos for weak signal</label>`);
  app.querySelectorAll<HTMLButtonElement>(".lesson").forEach((b) => (b.onclick = () => void showFilm(b.dataset.v!)));
  const low = document.getElementById("low") as HTMLInputElement;
  low.onchange = () => {
    localStorage.setItem("training:data", low.checked ? "low" : "normal");
    showSignal();
  };
}

/**
 * One film, played toward its next stop (SEGMENT-QUIZ D-TR13): at the end of each segment the film
 * pauses and that segment's questions are asked. The server decides where the stop is (`f.stop`) and
 * whether its questions are open (`f.status` "quiz"); the page only plays toward it.
 *
 * What counts as watching (§3.1): on screen, sound on, normal speed, nothing skipped. The film pauses
 * when the page is hidden and while it is muted; the server caps every span to the clock.
 */
async function showFilm(versionId: string, replayFrom?: number): Promise<void> {
  let f: TrainingPortalFilm;
  try {
    f = await api.film(versionId);
  } catch (e) {
    return problem(e);
  }
  // Open questions are asked at once — unless the driver chose to watch the part again first.
  if (f.status === "quiz" && replayFrom === undefined) return void showQuiz(f);
  if (f.status === "passed") return void showHome();
  const chosen = pickHeight(f.renditions.map((r) => r.height), dataMode(), conn());
  const r = f.renditions.find((x) => x.height === chosen) ?? f.renditions[0];
  if (!r) return problem(new LinkError("This video is not ready yet. Try again later.", "not_ready", 409));
  const stop = f.stop;
  const again = f.status === "rewatch" && stop !== null;
  render(`
    <h1>${esc(f.title)}</h1>
    ${again ? `<p class="note" data-test="rewatch-note">Watch “${esc(stop.title)}” again. Then you get new questions on what you missed.</p>` : ""}
    ${stop && !again ? `<p class="small" data-test="next-stop">The video stops after “${esc(stop.title)}” for 3 short questions.</p>` : ""}
    <video id="vid" src="${esc(r.url)}" poster="${esc(f.posterUrl)}" controls playsinline preload="metadata" controlslist="nodownload noplaybackrate" disablepictureinpicture>
      ${f.captionsUrl ? `<track kind="captions" src="${esc(f.captionsUrl)}" srclang="en" label="English" default>` : ""}
    </video>
    <p class="note" id="snd" data-test="sound-note" hidden>Turn the sound on: this video is spoken.</p>
    <p class="small">${r.height}p · ${megabytes(r.bytes)} for the whole video</p>
    <div id="stopnote" aria-live="polite"></div>
    <button class="big ghost" id="back">Back to my videos</button>`);

  const v = document.getElementById("vid") as HTMLVideoElement;
  const snd = document.getElementById("snd") as HTMLElement;
  const watched = f.watched.map(([a, b]) => [a, b] as [number, number]);
  const startAt = replayFrom ?? (again ? stop.startMs : f.positionMs);
  let playedTo = f.positionMs;
  let spanStart: number | null = null;
  let lastOk = startAt;
  let atStop = false;
  const rewatchStarts = again || replayFrom !== undefined ? [startAt] : [];

  v.addEventListener("loadedmetadata", () => {
    if (startAt > 0 && startAt < f.durationMs - 1000) v.currentTime = startAt / 1000;
  });
  v.addEventListener("ratechange", () => (v.playbackRate = 1)); // a span reported is a span watched at 1×
  // Sound on (§3.1): a muted film does not count, so it does not play. (An iPhone's hardware volume
  // cannot be read by a page; the questions catch a phone turned all the way down.)
  const soundOff = () => v.muted || v.volume === 0;
  const checkSound = () => {
    snd.hidden = !soundOff();
    if (soundOff() && !v.paused) v.pause();
  };
  v.addEventListener("volumechange", checkSound);
  v.addEventListener("play", checkSound);
  v.addEventListener("seeking", () => {
    const to = v.currentTime * 1000;
    if (!allowedSeek(to, watched, playedTo, rewatchStarts) || (stop && !atStop && to > stop.endMs)) v.currentTime = lastOk / 1000;
    else flush();
  });
  v.addEventListener("timeupdate", () => {
    const now = v.currentTime * 1000;
    if (!v.seeking) {
      lastOk = now;
      playedTo = Math.max(playedTo, now);
      if (spanStart === null && !v.paused) spanStart = now;
    }
    if (stop && !atStop && now >= stop.endMs - 250) {
      atStop = true;
      v.pause();
      void reachStop();
    }
  });
  /** Send what played since the last report (every 10 s, on pause, seek, end and leaving). */
  const flush = (): Promise<string | null> | null => {
    if (spanStart === null) return null;
    const span = { versionId: f.versionId, fromMs: Math.round(spanStart), toMs: Math.round(lastOk), positionMs: Math.round(lastOk) };
    spanStart = v.paused ? null : lastOk;
    if (span.toMs - span.fromMs < 500) return null;
    watched.push([span.fromMs, span.toMs]);
    return api.progress(span).then((sent) => (showSignal(), sent));
  };
  /** The segment's end: the server decides whether its questions open (they need signal: it grades). */
  const reachStop = async () => {
    await flush();
    const box = document.getElementById("stopnote")!;
    const now = await api.film(f.versionId).catch(() => null);
    if (now?.status === "quiz") return void showQuiz(now);
    if (!now) {
      box.innerHTML = `<p class="note">The questions need signal. What you watched is saved.</p><button class="big" id="retry">Try again</button>`;
    } else {
      // The server did not count enough of this part (reports lost on weak signal): play it again.
      box.innerHTML = `<p class="note">Part of “${esc(stop!.title)}” didn't count. Play it again from its start.</p><button class="big" id="retry">Play it again</button>`;
    }
    (document.getElementById("retry") as HTMLButtonElement).onclick = () => void showFilm(f.versionId);
  };
  const timer = window.setInterval(flush, 10_000);
  v.addEventListener("pause", flush);
  v.addEventListener("ended", flush);
  // On screen (§3.1): a hidden page does not count, so the film pauses with it.
  const onHide = () => {
    if (document.visibilityState === "hidden") {
      v.pause();
      void flush();
    }
  };
  document.addEventListener("visibilitychange", onHide);
  stopFilm = () => {
    void flush();
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onHide);
  };
  (document.getElementById("back") as HTMLButtonElement).onclick = () => void showHome();
}

/**
 * One stop's questions (D-TR14, D-TR15). All must be right to go on. A right answer shows why; a wrong
 * one shows nothing more, because the segment is watched again and the OTHER version of the question
 * asked. "Watch this part again" goes back to the segment before answering, and is not a miss.
 */
async function showQuiz(f: TrainingPortalFilm): Promise<void> {
  let q: TrainingPortalQuiz;
  try {
    q = await api.quiz(f.versionId);
  } catch (e) {
    return problem(e);
  }
  const fb: Record<string, TrainingAnswerFeedback | "saved"> = { ...q.answered };
  let i = q.questions.findIndex((x) => !fb[x.id]);
  if (i < 0) i = q.questions.length - 1;
  const total = q.questions.length;

  const ask = () => {
    const x = q.questions[i]!;
    render(`
      <p class="small" data-test="stop-title">Questions about “${esc(q.chapterTitle)}” · ${total === 1 ? "get it right to go on" : `all ${total} right to go on`}</p>
      <div class="dots" aria-hidden="true">${q.questions.map((_, k) => `<i class="${k <= i ? "on" : ""}"></i>`).join("")}</div>
      <p class="small">Question ${i + 1} of ${total}</p>
      <h2 class="q">${esc(x.prompt)}</h2>
      ${x.choices.map((c) => `<button class="ans" data-c="${esc(c.id)}">${esc(c.text)}</button>`).join("")}
      <div id="fb" aria-live="polite"></div>
      <button class="big ghost" id="again" data-test="watch-again">Watch this part again</button>`);
    app.querySelectorAll<HTMLButtonElement>(".ans").forEach((b) => (b.onclick = () => void choose(b.dataset.c!)));
    (document.getElementById("again") as HTMLButtonElement).onclick = () => void replay();
  };

  /** Back to the start of this segment; the open questions wait for when it ends again. */
  const replay = () => void showFilm(f.versionId, f.stop?.startMs ?? 0);

  const choose = async (choiceId: string) => {
    const x = q.questions[i]!;
    app.querySelectorAll<HTMLButtonElement>(".ans").forEach((b) => (b.disabled = true));
    (document.getElementById("again") as HTMLButtonElement).hidden = true;
    let out;
    try {
      out = await api.answer(q.attemptId, x.id, choiceId);
    } catch (e) {
      return problem(e);
    }
    const box = document.getElementById("fb")!;
    if (!out) {
      fb[x.id] = "saved";
      box.innerHTML = `<p class="note">No signal. Your answer is saved on this phone and will be checked when signal is back.</p>`;
    } else {
      fb[x.id] = out.feedback;
      const mine = app.querySelector<HTMLButtonElement>(`.ans[data-c="${CSS.escape(choiceId)}"]`);
      mine?.classList.add(out.feedback.right ? "right" : "wrong");
      box.innerHTML = out.feedback.right
        ? `<div class="why" data-test="why"><b>✓ Right.</b> ${esc(out.feedback.why ?? "")}</div>`
        : `<div class="why" data-test="why"><b>✗ Not quite.</b> This is in the part you're about to watch again.</div>`;
      if (out.result) return void box.insertAdjacentHTML("beforeend", `<button class="big" id="next">See how you did</button>`), next(() => result(out.result!));
    }
    showSignal();
    const last = i === total - 1;
    box.insertAdjacentHTML("beforeend", `<button class="big" id="next">${last ? "Send my answers" : "Next question"}</button>`);
    next(() => (last ? void finish() : (i++, ask())));
  };

  const next = (fn: () => void) => ((document.getElementById("next") as HTMLButtonElement).onclick = fn);

  const finish = async () => {
    const sent = await api.flushAnswers();
    const final = sent.map((s) => s.result.result).find(Boolean);
    if (final) return result(final);
    render(`<p class="lead">Your answers are saved on this phone. They will be checked as soon as you have signal; open this link again then.</p><button class="big ghost" id="back">Back to my videos</button>`);
    (document.getElementById("back") as HTMLButtonElement).onclick = () => void showHome();
  };

  const result = (r: { correct: number; total: number; passed: boolean }) => {
    const missed = r.total - r.correct;
    render(`
      <p class="score ${r.passed ? "pass" : "fail"}" data-test="score">${r.correct} / ${r.total}</p>
      <p class="verdict">${r.passed ? "All right." : "Not yet."}</p>
      ${
        r.passed
          ? `<p class="lead" style="text-align:center">On with the video.</p>`
          : `<p class="note" data-test="rewatch-plan">Watch “${esc(q.chapterTitle)}” again. Then you get ${missed === 1 ? "a new question" : `${missed} new questions`} on what you missed.</p>`
      }
      <button class="big" id="cont" data-test="continue">${r.passed ? "Go on" : "Watch it again"}</button>`);
    (document.getElementById("cont") as HTMLButtonElement).onclick = () => void showFilm(f.versionId);
  };

  ask();
}

window.addEventListener("online", () => {
  void api.flushSpans().then(showSignal);
});
window.addEventListener("offline", showSignal);

void showHome();
