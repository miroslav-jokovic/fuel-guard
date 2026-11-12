import { defineStore } from "pinia";
import { ref } from "vue";
import { ASSISTANT_QUESTION_MAX, assistantHistoryForRequest, readAssistantEvents, type AssistantAnswerLink, type AssistantStreamEvent } from "@silvicom/shared";
import { apiFetch, type ApiResult } from "@/lib/api";

/** The JSON answer, from an API that does not stream (or a refusal's shape). */
type AskJson = { answer: string; pages?: string[]; links?: AssistantAnswerLink[] };

/**
 * The assistant's conversation, one per tab (F21 redesign, PLAN D-AI9).
 *
 * A store rather than component state because the SAME thread has two hosts: the docked panel the
 * floating launcher opens over any page, and `/ask`, which shows it full width. Expanding the dock
 * into the page must not lose what was asked, and it would if each host kept its own list.
 *
 * ── FOLLOW-UPS (F21 R3a, 2026-11-10) ──────────────────────────────────────────────────────────────
 * Each question goes with the thread's earlier ANSWERED turns, trimmed by `assistantHistoryForRequest`,
 * the same rule the API applies, so "and last month?" keeps its subject. Only question and answer
 * text; the API re-reads every figure. A failed or pending turn is not sent: it has no answer, and
 * a retried question must not see its own failure as context. Until R3a the API took `{ question }`
 * alone (AUDIT W1) and the composer told the reader so.
 *
 * ── STREAMED (F21 Step 2d, 2026-11-12) ────────────────────────────────────────────────────────────
 * The median answer took 7.3 s on production, most of it spent reading reports before the first word
 * (PLAN §6). So a pending turn shows what is being read (`step`) and then the words as they come
 * (`draft`). The `done` event's `answer` is the record, and it replaces the draft. Text that arrived
 * before a step was the model's preamble to a tool call, so a step clears it. A stream that ends with
 * neither `done` nor `error` was cut off, and is an error the reader can retry.
 *
 * Not persisted: a reload starts empty. Q-AI4 (ruled 2026-11-11) keeps conversations tab-local; the
 * `ai.ask` audit row is the only record of a question.
 */

export interface AssistantTurn {
  id: number;
  question: string;
  status: "pending" | "done" | "error";
  answer: string | null;
  /** F21 R4a: the pages behind the answer, as surface keys (`assistantAnswerPages`). Absent from an older API. */
  pages?: string[];
  /** F21 R4b: the same pages with the answer's filters (`splitAssistantLink`). Absent from an older API. */
  links?: AssistantAnswerLink[];
  /** While pending: the report being read now, in the office's words. */
  step?: string;
  /** While pending: the answer's words so far. Replaced by `answer` when it is done. */
  draft?: string;
}

/** The endpoint's cap on a question (`assistantAskContract.ts`); the composer stops there too. */
export const QUESTION_MAX = ASSISTANT_QUESTION_MAX;

export const useAssistantStore = defineStore("assistant", () => {
  const turns = ref<AssistantTurn[]>([]);
  const open = ref(false);
  let seq = 0;

  const busy = () => turns.value.some((t) => t.status === "pending");

  /** The answered turns BEFORE this one, as the API takes them. */
  const historyBefore = (turn: AssistantTurn) =>
    assistantHistoryForRequest(
      turns.value.filter((t) => t.id < turn.id && t.status === "done" && t.answer).map((t) => ({ question: t.question, answer: t.answer })),
    );

  async function run(turn: AssistantTurn) {
    // Found again by id, not written through the captured object: that raw object is not the
    // reactive proxy. And an answer that lands after "New chat" finds no turn — ids never repeat —
    // so it is dropped rather than written into the new thread.
    const live = () => turns.value.find((t) => t.id === turn.id);
    let buffer = "";
    let ended = false;
    const apply = (e: AssistantStreamEvent) => {
      const t = live();
      if (!t || ended) return;
      if (e.type === "step") {
        t.step = e.label;
        t.draft = undefined;
      } else if (e.type === "text") {
        t.draft = (t.draft ?? "") + e.delta;
      } else {
        ended = true;
        t.step = undefined;
        t.draft = undefined;
        t.status = e.type === "done" ? "done" : "error";
        t.answer = e.type === "done" ? e.answer : e.message;
        if (e.type === "done") {
          t.pages = Array.isArray(e.pages) ? e.pages : [];
          t.links = Array.isArray(e.links) ? e.links : [];
        }
      }
    };
    let res: ApiResult<AskJson>;
    try {
      res = await apiFetch<AskJson>("/api/ai/ask", {
        method: "POST",
        body: { question: turn.question, history: historyBefore(turn) },
        stream: (chunk) => {
          const read = readAssistantEvents(buffer + chunk);
          buffer = read.rest;
          read.events.forEach(apply);
        },
      });
    } catch {
      res = { ok: false, status: 0, error: { code: "network", message: "The connection dropped before the answer finished. Try again." } };
    }
    if (ended) return;
    const t = live();
    if (!t) return;
    t.step = undefined;
    t.draft = undefined;
    if (res.ok && !res.data) {
      // Streamed, but neither `done` nor `error` arrived: cut off on the way.
      t.status = "error";
      t.answer = "The answer was cut off. Try again.";
      return;
    }
    applyJson(t, res);
  }

  /** The JSON answer: a refusal, or an API that does not stream yet. */
  function applyJson(live: AssistantTurn, res: ApiResult<AskJson>) {
    if (res.ok && res.data) {
      live.status = "done";
      live.answer = res.data.answer;
      live.pages = Array.isArray(res.data.pages) ? res.data.pages : [];
      live.links = Array.isArray(res.data.links) ? res.data.links : [];
    } else {
      live.status = "error";
      live.answer = res.error?.message ?? "Could not get an answer. Try again.";
    }
  }

  async function ask(raw: string) {
    const question = raw.trim().slice(0, QUESTION_MAX);
    if (!question || busy()) return;
    const turn: AssistantTurn = { id: ++seq, question, status: "pending", answer: null };
    turns.value.push(turn);
    await run(turn);
  }

  async function retry(id: number) {
    const turn = turns.value.find((t) => t.id === id);
    if (!turn || turn.status !== "error" || busy()) return;
    turn.status = "pending";
    turn.answer = null;
    await run(turn);
  }

  function clear() {
    turns.value = [];
  }

  return { turns, open, ask, retry, clear, busy };
});
