import {
  missingPhotoSlots,
  nextStop,
  photoSlotLabel,
  type Load,
  type LoadStop,
  type MeHazmatLoadRow,
} from '@silvicom/shared';

/**
 * What the Documents tab says (Visual 2026 V7, the V1 mock's screen 7): a review queue, after Copilot
 * Money. What is still missing comes first, then the hazmat verdicts, then what was sent. Decided here
 * so `apps/driver/tests/documents-model.test.ts` can pin it.
 *
 * Documents used to be only the hazmat hub. The missing stop photos live on the loads, and a driver
 * asked "what do I still owe the office" had to open every stop to find out. They are read from the
 * same `/api/me/loads` payload the Loads tab uses; nothing new is fetched.
 *
 * Honesty limits:
 * - A photo is "missing" only on a stop that requires it and has no photo in that slot on the server.
 * - Only the load being DRIVEN (`in_transit`) owes photos. An accepted load not started yet is
 *   tomorrow's work: counting its stops made "14 photos missing" on a morning with one stop to go
 *   (simulator, 2026-11-20), and a list where everything is urgent says nothing is.
 * - "Take" is offered only where the app can take it: the load's next open stop. Its later stops
 *   say "Later".
 *   A finished stop's gap is shown as a record with no action, because `driver_complete_stop`
 *   (migration 0141) refuses photos for a finished stop (Q-DV7).
 * - "Sent" counts photos the server already holds (`uploaded_at`), which is what "received" means.
 *   Photos still on the phone are the outbox's to report (the sync rows), never counted here.
 */

export interface MissingPhotoRow {
  key: string;
  loadId: string;
  stopId: string;
  title: string;
  subtitle: string;
  /** `take`: open stop, can capture now. `later`: a later stop on the run. `record`: finished, no action. */
  when: 'take' | 'later' | 'record';
}

export interface DocumentsView {
  missing: MissingPhotoRow[];
  /** The count in the status block and on the tab badge: what the driver can still do something about. */
  actionable: number;
  /** One sentence under the count, naming the load(s) the missing photos are on. */
  missingNote: string | null;
  sentThisWeek: { photos: number; loads: number } | null;
}

export function documentsView(loads: readonly Load[], now: number = Date.now()): DocumentsView {
  const missing: MissingPhotoRow[] = [];
  const working = loads.filter((l) => l.status === 'in_transit');

  for (const load of working) {
    const next = nextStop(load);
    for (const stop of ordered(load)) {
      const finished = stop.status === 'completed' || stop.status === 'skipped';
      // A skipped stop was explained with a reason (D21); its photos are not owed.
      if (stop.status === 'skipped') continue;
      for (const slot of missingPhotoSlots(stop)) {
        missing.push({
          key: `${stop.id}-${slot}`,
          loadId: load.id,
          stopId: stop.id,
          title: `${photoSlotLabel(slot)} · ${stop.name}`,
          subtitle: `Load ${load.ref} · stop ${stop.seq} · ${stop.kind === 'pickup' ? 'pickup' : 'delivery'}${finished ? ' · finished without it' : ''}`,
          when: finished ? 'record' : stop.id === next?.id ? 'take' : 'later',
        });
      }
    }
  }
  // What the driver can do now first, then later stops, then the records.
  const rank = { take: 0, later: 1, record: 2 } as const;
  missing.sort((a, b) => rank[a.when] - rank[b.when]);

  const actionable = missing.filter((m) => m.when !== 'record').length;
  const refs = [...new Set(missing.filter((m) => m.when !== 'record').map((m) => loads.find((l) => l.id === m.loadId)?.ref))];
  const missingNote = actionable === 0 ? null : `${whoIsOn(actionable, refs.length)} ${refs.length === 1 ? 'load' : 'loads'} ${refs.join(', ')}. The office sees them as soon as you send them.`;

  return { missing, actionable, missingNote, sentThisWeek: sentSince(loads, now - 7 * 86_400_000) };
}

function whoIsOn(count: number, loadCount: number): string {
  if (count === 1) return 'It is on';
  if (loadCount > 1) return 'They are on';
  return count === 2 ? 'Both are on' : 'All are on';
}

function sentSince(loads: readonly Load[], since: number): DocumentsView['sentThisWeek'] {
  let photos = 0;
  const onLoads = new Set<string>();
  for (const load of loads) {
    for (const stop of load.stops) {
      for (const p of stop.photos) {
        if (Date.parse(p.uploaded_at) >= since) {
          photos += 1;
          onLoads.add(load.id);
        }
      }
    }
  }
  return photos === 0 ? null : { photos, loads: onLoads.size };
}

/** A hazmat check as a row: the verdict is a WORD in its state colour, never a pill (D-DV14). */
export interface HazmatRowView {
  key: string;
  id: string;
  title: string;
  subtitle: string;
  verdict: { text: string; tone: 'done' | 'stop' | 'act' | 'live' | 'neutral' };
}

const VERDICT: Record<string, HazmatRowView['verdict']> = {
  cleared: { text: 'Cleared', tone: 'done' },
  analysis_green: { text: 'Cleared', tone: 'done' },
  rejected: { text: 'Rejected', tone: 'stop' },
  needs_review: { text: 'In review', tone: 'act' },
};

export function hazmatRows(rows: readonly MeHazmatLoadRow[]): HazmatRowView[] {
  return rows.map((row) => ({
    key: row.id,
    id: row.id,
    title: `BOL check · ${shortDate(row.created_at)}`,
    subtitle: row.status === 'draft' ? 'Saved on this phone · sends when you have signal' : `Captured ${clock(row.created_at)}`,
    verdict: row.latest_outcome
      ? (VERDICT[row.latest_outcome] ?? { text: 'In review', tone: 'act' })
      : row.status === 'draft'
        ? { text: 'Not sent', tone: 'neutral' }
        : { text: 'Analyzing', tone: 'live' },
  }));
}

function ordered(load: Pick<Load, 'stops'>): LoadStop[] {
  return [...load.stops].sort((a, b) => a.seq - b.seq);
}

/** MM/DD: the short form of the app's MM/DD/YYYY dates. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
