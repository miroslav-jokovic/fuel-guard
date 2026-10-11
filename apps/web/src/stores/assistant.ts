import { defineStore } from "pinia";
import { ref } from "vue";
import { apiFetch } from "@/lib/api";

/**
 * The assistant's conversation, one per tab (F21 redesign, PLAN D-AI9).
 *
 * A store rather than component state because the SAME thread has two hosts: the docked panel the
 * floating launcher opens over any page, and `/ask`, which shows it full width. Expanding the dock
 * into the page must not lose what was asked, and it would if each host kept its own list.
 *
 * ⚠ The API still answers ONE question at a time, with no memory of the last: `POST /api/ai/ask`
 * takes `{ question }` and nothing else (AUDIT W1). The thread is a display of independent answers,
 * not a conversation the model can see — which is why the composer says so, rather than letting
 * "and last month?" quietly reach the model with no subject. Sending history is Step 2 of the plan.
 *
 * Not persisted: a reload starts empty. Retention of questions is the owner's open Q-AI4.
 */

export interface AssistantTurn {
  id: number;
  question: string;
  status: "pending" | "done" | "error";
  answer: string | null;
}

/** The endpoint caps a question at 500 characters (`routes/ai.ts`); the composer stops there too. */
export const QUESTION_MAX = 500;

export const useAssistantStore = defineStore("assistant", () => {
  const turns = ref<AssistantTurn[]>([]);
  const open = ref(false);
  let seq = 0;

  const busy = () => turns.value.some((t) => t.status === "pending");

  async function run(turn: AssistantTurn) {
    const res = await apiFetch<{ answer: string }>("/api/ai/ask", { method: "POST", body: { question: turn.question } });
    // Found again by id, not written through the captured object: that raw object is not the
    // reactive proxy. And an answer that lands after "New chat" finds no turn — ids never repeat —
    // so it is dropped rather than written into the new thread.
    const live = turns.value.find((t) => t.id === turn.id);
    if (!live) return;
    if (res.ok && res.data) {
      live.status = "done";
      live.answer = res.data.answer;
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
