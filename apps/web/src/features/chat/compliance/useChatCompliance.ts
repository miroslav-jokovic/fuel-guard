import { type Ref, toValue } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type {
  ChatComplianceAccessLogResponse,
  ChatComplianceConversationsRequest,
  ChatComplianceConversationsResponse,
  ChatComplianceMessagesRequest,
  ChatComplianceMessagesResponse,
  ChatCompliancePerson,
  ChatComplianceReason,
  ChatComplianceThreadRequest,
  ChatComplianceThreadResponse,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { apiRefusal } from "@/composables/useStepUpRetry";

/**
 * The compliance console's data layer (OFFICE-CHAT-PLAN CHA2). Everything through
 * `/api/chat/compliance`, which answers only for a holder of the `chat.compliance` permission.
 *
 * The three reads that return another person's words are NOT queries: each is an act the database
 * records with the reason given, so it runs when the person presses Search or opens a conversation,
 * never on a re-render or a window refocus. They throw an Error carrying the API's `code`, the shape
 * `useStepUpRetry` reads — a `step_up_required` refusal becomes the password prompt and the same act
 * runs again once confirmed.
 */
const BASE = "/api/chat/compliance";

async function act<T>(path: string, body: object, fallback: string): Promise<T> {
  const r = await apiFetch<T>(path, { method: "POST", body });
  if (!r.ok || r.data === undefined || r.data === null) throw apiRefusal(r.ok ? undefined : r.error, fallback);
  return r.data;
}

export function searchConversations(req: ChatComplianceConversationsRequest): Promise<ChatComplianceConversationsResponse> {
  return act(`${BASE}/conversations`, req, "Could not search the conversations.");
}

export function searchMessages(req: ChatComplianceMessagesRequest): Promise<ChatComplianceMessagesResponse> {
  return act(`${BASE}/messages`, req, "Could not search the messages.");
}

export function openThread(threadId: string, req: ChatComplianceThreadRequest): Promise<ChatComplianceThreadResponse> {
  return act(`${BASE}/conversations/${threadId}`, req, "Could not open the conversation.");
}

/** Who the console can filter by. Names only, so it may load with the page. */
export function useCompliancePeopleQuery() {
  return useQuery({
    queryKey: ["chat", "compliance", "people"],
    queryFn: async () => {
      const r = await apiFetch<{ people: ChatCompliancePerson[] }>(`${BASE}/people`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the people list.");
      return r.data.people;
    },
    staleTime: 5 * 60_000,
  });
}

/** Who looked, when, at what and why — one page, older than `beforeSeq`. */
export function useComplianceAccessLogQuery(beforeSeq: Ref<number | null>) {
  return useQuery({
    queryKey: ["chat", "compliance", "access-log", beforeSeq],
    queryFn: async () => {
      const q = new URLSearchParams();
      const b = toValue(beforeSeq);
      if (b) q.set("before_seq", String(b));
      const r = await apiFetch<ChatComplianceAccessLogResponse>(`${BASE}/access-log?${q}`);
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? "Could not load the access log.");
      return r.data;
    },
  });
}

/** A `<input type="date">` value as the instant a day starts, in the browser's zone; null when empty. */
export function dayStartIso(day: string | null | undefined, plusDays = 0): string | undefined {
  if (!day) return undefined;
  const d = new Date(`${day}T00:00:00`);
  if (Number.isNaN(d.getTime())) return undefined;
  d.setDate(d.getDate() + plusDays);
  return d.toISOString();
}

/** Is the reason complete enough to send? Mirrors the contract's bounds without importing zod into the page. */
export function reasonComplete(r: { category: string | null; text: string }): r is ChatComplianceReason {
  return !!r.category && r.text.trim().length >= 10 && r.text.trim().length <= 500;
}

/** The person running the console passes one task through: a step-up refusal is held and retried. */
export type RunAct = (task: () => Promise<void>) => Promise<void>;
