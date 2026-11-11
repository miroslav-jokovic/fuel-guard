import { defineStore } from "pinia";
import { ref } from "vue";
import { ASSISTANT_QUESTION_MAX, assistantHistoryForRequest } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

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
    const res = await apiFetch<{ answer: string; pages?: string[] }>("/api/ai/ask", {
      method: "POST",
      body: { question: turn.question, history: historyBefore(turn) },
    });
    // Found again by id, not written through the captured object: that raw object is not the
    // reactive proxy. And an answer that lands after "New chat" finds no turn — ids never repeat —
    // so it is dropped rather than written into the new thread.
    const live = turns.value.find((t) => t.id === turn.id);
    if (!live) return;
    if (res.ok && res.data) {
      live.status = "done";
      live.answer = res.data.answer;
      live.pages = Array.isArray(res.data.pages) ? res.data.pages : [];
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
