/**
 * Lamp readings → lamp-on EPISODES (WARNING-DESK-PLAN D-WD5). Pure.
 *
 * A trailer's ATIS lamp and a truck's engine lamps are states, not events: Samsara reports "on" and
 * "off", and a leaking tire cycles the ATIS lamp all day (8,933 changes on 120 trailers in 30 days,
 * measured 2026-11-26). The desk wants the episode — "on from 09:12 to 11:40" — so that is all that is
 * stored: one warning row per episode, `still_active` while the lamp is on.
 *
 * Two lamp-on stretches less than MERGE_GAP apart are ONE episode: the inflation system pumps, the
 * lamp goes off, the tire leaks down again. Counting each would turn one leak into a dozen warnings
 * and the Nth-time rule into noise. The rule's 10-minute minimum (an episode shorter than that is
 * not a warning — Samsara's own lamp definition) is applied by the evaluator, not here, so a short
 * episode that grows is never lost.
 */

export const MERGE_GAP_MS = 30 * 60_000;

export interface Episode {
  /** `source_key` of the warning row: `<entity>:<lamp>:<onset ISO>`. */
  key: string;
  entityId: string;
  lamp: string;
  startedAt: string;
  endedAt: string | null;
  active: boolean;
}

export interface LampObservation {
  entityId: string;
  lamp: string;
  at: string;
  on: boolean;
}

export const episodeKey = (entityId: string, lamp: string, startedAt: string) => `${entityId}:${lamp}:${startedAt}`;
const stateKey = (entityId: string, lamp: string) => `${entityId}\u0000${lamp}`;

/**
 * Apply observations, oldest first, to the latest known episode per (entity, lamp). Returns every
 * episode that was started, re-opened or ended — the rows to write. `latest` is not mutated.
 */
export function foldLampObservations(latest: readonly Episode[], observations: readonly LampObservation[]): Episode[] {
  const state = new Map<string, Episode>();
  for (const e of latest) state.set(stateKey(e.entityId, e.lamp), { ...e });
  const changed = new Map<string, Episode>();
  const sorted = [...observations].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const o of sorted) {
    const k = stateKey(o.entityId, o.lamp);
    const cur = state.get(k);
    const t = Date.parse(o.at);
    if (o.on) {
      if (cur?.active) continue;
      if (cur && cur.endedAt && t - Date.parse(cur.endedAt) <= MERGE_GAP_MS && t >= Date.parse(cur.startedAt)) {
        const reopened = { ...cur, endedAt: null, active: true };
        state.set(k, reopened);
        changed.set(reopened.key, reopened);
        continue;
      }
      if (cur && t < Date.parse(cur.endedAt ?? cur.startedAt)) continue; // a reading older than what we know
      const fresh: Episode = { key: episodeKey(o.entityId, o.lamp, o.at), entityId: o.entityId, lamp: o.lamp, startedAt: o.at, endedAt: null, active: true };
      state.set(k, fresh);
      changed.set(fresh.key, fresh);
    } else if (cur?.active && t >= Date.parse(cur.startedAt)) {
      const ended = { ...cur, endedAt: o.at, active: false };
      state.set(k, ended);
      changed.set(ended.key, ended);
    }
  }
  return [...changed.values()];
}
