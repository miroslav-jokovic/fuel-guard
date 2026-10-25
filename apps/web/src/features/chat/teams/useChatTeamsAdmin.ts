import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { ChatCreateTeamRequest, ChatTeamDirectoryEntry } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { CHAT_KEY } from "../useChat";

/**
 * Settings → Chat teams' data layer (OFFICE-CHAT-PLAN CH5b, D-CHAT21). Every team of the organisation,
 * from `/api/chat/teams/directory`, which answers only for a holder of the `chat.teams` permission;
 * making a team asks the same permission, and archiving hands the caller's answer to the database,
 * which lets a holder archive a team they are not in. None of it reads a team's messages.
 */
export const teamDirectoryKey = [...CHAT_KEY, "team-directory"] as const;

async function unwrap<T>(p: ReturnType<typeof apiFetch<T>>, fallback: string): Promise<T> {
  const res = await p;
  if (!res.ok || res.data === undefined || res.data === null) throw new Error(res.error?.message ?? fallback);
  return res.data;
}

export function useTeamDirectoryQuery() {
  return useQuery({
    queryKey: teamDirectoryKey,
    queryFn: async () =>
      (await unwrap(apiFetch<{ teams: ChatTeamDirectoryEntry[] }>("/api/chat/teams/directory"), "Could not load the teams.")).teams,
  });
}

/** Both acts change the rail as well as this page, so both refresh everything under the chat key. */
function useChatTeamsMutation<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: CHAT_KEY }) });
}

export function useCreateTeam() {
  return useChatTeamsMutation((req: ChatCreateTeamRequest) =>
    unwrap(apiFetch<{ space_id: string }>("/api/chat/teams", { method: "POST", body: req }), "Could not make the team."),
  );
}

export function useArchiveTeam() {
  return useChatTeamsMutation((spaceId: string) =>
    unwrap(apiFetch<{ ok: true }>(`/api/chat/teams/${spaceId}/archive`, { method: "POST", body: {} }), "Could not archive the team."),
  );
}
