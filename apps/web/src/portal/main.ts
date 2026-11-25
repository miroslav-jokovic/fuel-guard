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
 * fonts, and nothing else. `lint:portal-size` holds it under budget.
 *
 * The flow is the mockup's: list → film (chapters, resume, no skipping ahead on a first watch) → quiz
 * (the reason after each answer) → result (a fail names the chapters to watch again; a pass opens the
 * next film).
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

const STATUS: Record<string, string> = { locked: "🔒 After the video before", watch: "▶ Start", rewatch: "↺ Watch the missed parts", quiz: "✎ Take the quiz", passed: "✓ Passed" };

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

async function showFilm(versionId: string): Promise<void> {
  let f: TrainingPortalFilm;
  try {
    f = await api.film(versionId);
  } catch (e) {
    return problem(e);
  }
  const chosen = pickHeight(f.renditions.map((r) => r.height), dataMode(), conn());
  const r = f.renditions.find((x) => x.height === chosen) ?? f.renditions[0];
  if (!r) return problem(new LinkError("This video is not ready yet. Try again later.", "not_ready", 409));
  const starts = f.chapters.length ? f.chapters : [{ title: "Whole video", startMs: 0 }];
  const ends = starts.map((_c, i) => starts[i + 1]?.startMs ?? f.durationMs);
  const rewatch = new Set(f.rewatch);
  render(`
    <h1>${esc(f.title)}</h1>
    ${rewatch.size ? `<p class="note">Watch the chapters marked ↺ again, then take the quiz again. You'll get new questions.</p>` : ""}
    <video id="vid" src="${esc(r.url)}" poster="${esc(f.posterUrl)}" controls playsinline preload="metadata" controlslist="nodownload noplaybackrate" disablepictureinpicture>
      ${f.captionsUrl ? `<track kind="captions" src="${esc(f.captionsUrl)}" srclang="en" label="English" default>` : ""}
    </video>
    <p class="small">${r.height}p · ${megabytes(r.bytes)} for the whole video</p>
    <div class="chips">${starts
      .map((c, i) => `<button class="chip${rewatch.has(i) ? " again" : ""}" data-at="${c.startMs}"><b>${rewatch.has(i) ? "↺" : i + 1}</b> ${esc(c.title)}<br><span class="m">${clock(c.startMs)}–${clock(ends[i]!)}</span></button>`)
      .join("")}</div>
    <button class="big" id="go" ${f.status === "quiz" ? "" : "hidden"}>Take the quiz</button>
    <button class="big ghost" id="back">Back to my videos</button>`);

  const v = document.getElementById("vid") as HTMLVideoElement;
  const go = document.getElementById("go") as HTMLButtonElement;
  const watched = f.watched.map(([a, b]) => [a, b] as [number, number]);
  let playedTo = f.positionMs;
  let spanStart: number | null = null;
  let lastOk = f.positionMs;
  const rewatchStarts = [...rewatch].map((i) => starts[i]?.startMs ?? 0);

  v.addEventListener("loadedmetadata", () => {
    if (f.positionMs > 0 && f.positionMs < f.durationMs - 3000) v.currentTime = f.positionMs / 1000;
  });
  v.addEventListener("ratechange", () => (v.playbackRate = 1)); // a span reported is a span watched at 1×
  v.addEventListener("seeking", () => {
    const to = v.currentTime * 1000;
    if (!allowedSeek(to, watched, playedTo, rewatchStarts)) v.currentTime = lastOk / 1000;
    else flush();
  });
  v.addEventListener("timeupdate", () => {
    const now = v.currentTime * 1000;
    if (!v.seeking) {
      lastOk = now;
      playedTo = Math.max(playedTo, now);
      if (spanStart === null && !v.paused) spanStart = now;
    }
    app.querySelectorAll<HTMLButtonElement>(".chip").forEach((c, i) => c.classList.toggle("on", now >= starts[i]!.startMs && now < ends[i]!));
  });
  /** Send what played since the last report (every 10 s, on pause, seek, end and leaving). */
  const flush = () => {
    if (spanStart === null) return;
    const span = { versionId: f.versionId, fromMs: Math.round(spanStart), toMs: Math.round(lastOk), positionMs: Math.round(lastOk) };
    spanStart = v.paused ? null : lastOk;
    if (span.toMs - span.fromMs < 500) return;
    watched.push([span.fromMs, span.toMs]);
    void api.progress(span).then(async (sent) => {
      showSignal();
      if (sent && go.hidden) {
        // The server decides when the quiz opens; ask it rather than guessing on the phone.
        const again = await api.film(f.versionId).catch(() => null);
        if (again?.status === "quiz") go.hidden = false;
      }
    });
  };
  const timer = window.setInterval(flush, 10_000);
  v.addEventListener("pause", flush);
  v.addEventListener("ended", flush);
  const onHide = () => document.visibilityState === "hidden" && flush();
  document.addEventListener("visibilitychange", onHide);
  stopFilm = () => {
    flush();
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onHide);
  };

  app.querySelectorAll<HTMLButtonElement>(".chip").forEach((c) => {
    c.onclick = () => {
      const at = Number(c.dataset.at);
      if (allowedSeek(at, watched, playedTo, rewatchStarts)) {
        v.currentTime = at / 1000;
        void v.play();
      }
    };
  });
  go.onclick = () => void showQuiz(f);
  (document.getElementById("back") as HTMLButtonElement).onclick = () => void showHome();
}

async function showQuiz(f: TrainingPortalFilm): Promise<void> {
  let q: TrainingPortalQuiz;
  try {
    q = await api.quiz(f.versionId);
  } catch (e) {
    return problem(e);
  }
  const fb: Record<string, TrainingAnswerFeedback | "saved"> = { ...q.answered };
  const chapterTitle = (i: number) => (f.chapters[i] ?? { title: "Whole video" }).title;
  let i = q.questions.findIndex((x) => !fb[x.id]);
  if (i < 0) i = q.questions.length - 1;

  const ask = () => {
    const x = q.questions[i]!;
    render(`
      <div class="dots" aria-hidden="true">${q.questions.map((_, k) => `<i class="${k <= i ? "on" : ""}"></i>`).join("")}</div>
      <p class="small">Question ${i + 1} of ${q.questions.length}</p>
      <h2 class="q">${esc(x.prompt)}</h2>
      ${x.choices.map((c) => `<button class="ans" data-c="${esc(c.id)}">${esc(c.text)}</button>`).join("")}
      <div id="fb" aria-live="polite"></div>`);
    app.querySelectorAll<HTMLButtonElement>(".ans").forEach((b) => (b.onclick = () => void choose(b.dataset.c!)));
  };

  const choose = async (choiceId: string) => {
    const x = q.questions[i]!;
    app.querySelectorAll<HTMLButtonElement>(".ans").forEach((b) => (b.disabled = true));
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
      app.querySelectorAll<HTMLButtonElement>(".ans").forEach((b) => {
        if (b.dataset.c === out.feedback.answer) b.classList.add("right");
        else if (b.dataset.c === choiceId) b.classList.add("wrong");
      });
      box.innerHTML = `<div class="why"><b>${out.feedback.right ? "✓ Right." : "✗ Not quite."}</b> ${esc(out.feedback.why)}<br><span class="small">From chapter ${out.feedback.chapter + 1}, "${esc(chapterTitle(out.feedback.chapter))}"</span></div>`;
      if (out.result) return void box.insertAdjacentHTML("beforeend", `<button class="big" id="next">See my result</button>`), next(() => result(out.result!));
    }
    showSignal();
    const last = i === q.questions.length - 1;
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

  const result = (r: { correct: number; total: number; passed: boolean; missedChapters: number[] }) => {
    render(`
      <p class="score ${r.passed ? "pass" : "fail"}">${r.correct} / ${r.total}</p>
      <p class="verdict">${r.passed ? "Passed." : `Not yet. You need ${q.passCount} of ${r.total}.`}</p>
      ${r.passed ? "" : `<p class="note">Watch ${r.missedChapters.length > 1 ? "these chapters" : "this chapter"} again, then take the quiz again. You'll get new questions.</p>
        <ul class="miss">${r.missedChapters.map((c) => `<li>${esc(chapterTitle(c))}</li>`).join("")}</ul>`}
      <button class="big" id="cont">${r.passed ? "Back to my videos" : "Watch again"}</button>`);
    (document.getElementById("cont") as HTMLButtonElement).onclick = () => void (r.passed ? showHome() : showFilm(f.versionId));
  };

  ask();
}

window.addEventListener("online", () => {
  void api.flushSpans().then(showSignal);
});
window.addEventListener("offline", showSignal);

void showHome();
