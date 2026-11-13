import { computed, type Ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  CHAT_DND_MORNING,
  CHAT_DND_NONE,
  nextWallClock,
  type ChatDndScheduleRequest,
  type ChatDndState,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { CHAT_KEY } from "./useChat";

/**
 * The person's Do not disturb (CHAT-WEB-PUSH-PLAN WP5), read and set through `/api/chat/push/quiet`.
 *
 * ONE STATE FOR EVERY DEVICE: it lives on the server, so a pause pressed on the PC quiets the phone, whose
 * pushes the server simply does not send (0603). This tab reads it for two things: the rail's control, and the
 * in-tab desktop alerts (CH6d), which must keep the same quiet as the phone.
 *
 * Refreshed every minute while chat is open, so a pause that runs out, or a nightly window that opens, reaches
 * the desktop alerts within a minute. Between refreshes a pause is also judged by its own end instant, which
 * needs no server: the one piece of the rule that is a plain comparison. The nightly window is never judged
 * here — `quiet_now` is the database's answer (D-WP13: one rule).
 */
export const dndKey = [...CHAT_KEY, "dnd"] as const;
const REFRESH_MS = 60_000;

async function put(path: string, body: object): Promise<ChatDndState> {
  const res = await apiFetch<ChatDndState>(`/api/chat/push/quiet${path}`, { method: "PUT", body });
  if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not change Do not disturb.");
  return res.data;
}

/** The browser's own zone — where "tomorrow morning" and the nightly window are read. */
export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function useChatDnd(enabled: Ref<boolean> = computed(() => true)) {
  const qc = useQueryClient();
  const state = useQuery({
    queryKey: dndKey,
    enabled,
    queryFn: async () => {
      const res = await apiFetch<ChatDndState>("/api/chat/push/quiet");
      if (!res.ok || !res.data) throw new Error("Could not load Do not disturb.");
      return res.data;
    },
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS / 2,
  });
  const current = computed<ChatDndState>(() => state.data.value ?? CHAT_DND_NONE);
  const pausedUntil = computed(() => {
    const at = current.value.paused_until ? Date.parse(current.value.paused_until) : NaN;
    return Number.isFinite(at) && at > Date.now() ? new Date(at) : null;
  });
  /** Held back right now: the server's answer, less a pause that has run out since it was read. */
  const quietNow = (): boolean => {
    const s = current.value;
    if (!s.quiet_now) return false;
    const pauseOver = s.paused_until !== null && Date.parse(s.paused_until) <= Date.now();
    // A pause that has just ended leaves the window's answer unknown until the next read: say not quiet —
    // an alert too many is better than a missed one (0603's "I could not tell must never silence").
    return !pauseOver;
  };

  const set = (next: ChatDndState) => qc.setQueryData(dndKey, next);
  const pause = useMutation({ mutationFn: (until: Date | null) => put("/pause", { until: until ? until.toISOString() : null }), onSuccess: set });
  const schedule = useMutation({ mutationFn: (body: ChatDndScheduleRequest) => put("/schedule", body), onSuccess: set });

  return {
    state,
    current,
    pausedUntil,
    quietNow,
    pauseForAnHour: () => pause.mutateAsync(new Date(Date.now() + 3_600_000)),
    pauseUntilMorning: () => pause.mutateAsync(nextWallClock(new Date(), browserZone(), CHAT_DND_MORNING.hour, CHAT_DND_MORNING.minute)),
    resume: () => pause.mutateAsync(null),
    setWindow: (start: string | null, end: string | null) => schedule.mutateAsync({ start, end, timezone: browserZone() }),
    busy: computed(() => pause.isPending.value || schedule.isPending.value),
  };
}
