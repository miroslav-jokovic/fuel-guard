import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { RouteLocationRaw } from "vue-router";
import {
  CHAT_ABOUT_READ_SECTION,
  SURFACES,
  canReachSurface,
  chatAboutTitle,
  surfaceAllowed,
  type ChatAboutKind,
  type ChatAboutListResponse,
  type ChatCreateAboutRequest,
  type ChatThreadAboutResponse,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { useModulesQuery } from "@/composables/useModules";
import { useSessionStore } from "@/stores/session";
import { CHAT_KEY, inboxKey, unwrap } from "./useChat";

/**
 * "Chat about this" in chat (OFFICE-CHAT-PLAN CH11b, D-CHAT34): what a group is about, for its header.
 * Asked once per conversation and kept — a conversation's record is fixed when it is made (D-CHAT31), so
 * there is nothing to refetch. Only a group can be about anything, so nothing else asks.
 */
export const aboutKey = (threadId: string | null) => [...CHAT_KEY, "about", threadId] as const;

/** The page a record lives on — the router's own names for them. */
export function chatAboutRoute(kind: ChatAboutKind, id: string): RouteLocationRaw {
  const name = kind === "load" ? "load-detail" : kind === "driver" ? "driver-detail" : "vehicle-detail";
  return { name, params: { id } };
}

export function useChatThreadAbout(threadId: Ref<string | null>, isGroup: Ref<boolean>) {
  const q = useQuery({
    queryKey: computed(() => aboutKey(threadId.value)),
    enabled: computed(() => !!threadId.value && isGroup.value),
    staleTime: Infinity,
    queryFn: () => unwrap(apiFetch<ChatThreadAboutResponse>(`/api/chat/${threadId.value}/about`), "Could not read what this conversation is about."),
  });
  /** The header's link, or null while unknown, for a conversation about nothing, or when the ask failed. */
  const link = computed(() => {
    const a = q.data.value?.about;
    return a ? { label: chatAboutTitle(a.kind, a.label), to: chatAboutRoute(a.kind, a.record_id) } : null;
  });
  return { ...q, link };
}

// ── On a record's page (CH11c, D-CHAT32–34) ──────────────────────────────────────────────────────

const CHAT_SURFACE = SURFACES.find((s) => s.key === "chat")!;

/**
 * May this person use "Chat about this" on a record of this kind? Exactly when the sidebar offers Chat
 * — the same three layers (module, gate, the org's screen answer; `useAssistantAccess` reads Ask AI the
 * same way) — AND they may read that kind of record (`CHAT_ABOUT_READ_SECTION`, the API's own check),
 * so the card is never offered to somebody the API would refuse.
 */
export function useChatAboutAccess(kind: Ref<ChatAboutKind>) {
  const session = useSessionStore();
  const modules = useModulesQuery();
  return computed(() => {
    if (!session.isAuthenticated) return false;
    if (!canReachSurface(CHAT_SURFACE, session.role, modules.data.value ?? null, session.sections)) return false;
    if (!surfaceAllowed(CHAT_SURFACE, session.role, session.sections, session.surfaces)) return false;
    const section = CHAT_ABOUT_READ_SECTION[kind.value];
    return section === null || session.canView(section);
  });
}

export const aboutListKey = (kind: ChatAboutKind, recordId: string) => [...CHAT_KEY, "about-list", kind, recordId] as const;

/** The conversations about one record that the viewer is in (`GET /api/chat/about/:kind/:id`). */
export function useChatAboutList(kind: Ref<ChatAboutKind>, recordId: Ref<string | null>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: computed(() => aboutListKey(kind.value, recordId.value ?? "")),
    enabled: computed(() => enabled.value && !!recordId.value),
    queryFn: async () =>
      (await unwrap(apiFetch<ChatAboutListResponse>(`/api/chat/about/${kind.value}/${recordId.value}`), "Could not load the conversations about this.")).conversations,
  });
}

/** Start a group about a record; answers its id. The record's list and the inbox refetch. */
export function useChatCreateAbout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (req: ChatCreateAboutRequest) =>
      (await unwrap(apiFetch<{ thread_id: string }>("/api/chat/about", { method: "POST", body: req }), "Could not start the conversation.")).thread_id,
    onSuccess: (_id, req) => {
      void qc.invalidateQueries({ queryKey: aboutListKey(req.kind, req.record_id) });
      void qc.invalidateQueries({ queryKey: inboxKey });
    },
  });
}
