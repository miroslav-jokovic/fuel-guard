import { Platform } from 'react-native';
import type { Load } from '@silvicom/shared';
import StopActivity from './StopActivity';
import StopWidget from './StopWidget';
import { activityCommand, glanceTimeline, idleProps, type GlanceEntry, type GlanceProps } from './glanceModel';

/**
 * Pushes `glanceModel`'s answer to the system: the widget's timeline and the one Live Activity. The
 * decisions are the model's (tested); this file only performs them and remembers what it last sent,
 * so an unchanged minute writes nothing.
 *
 * A failure here must never reach the driver's screen. Live Activities can be switched off per app in
 * iOS Settings, and then `start` throws; the widget is simply not shown. Both are a missing glance,
 * not an error in the app, so they are swallowed. In development they are logged once.
 */

let lastTimeline: string | null = null;
let shownActivity: GlanceProps | null = null;
let warned = false;

export function syncGlance(input: { load: Load | null; onDuty: boolean; now: number }): void {
  const entries = glanceTimeline(input.load, input.now, input.onDuty);
  pushTimeline(entries);
  pushActivity(input.load, input.now);
}

/** Sign-out: no stop of this driver's may stay on a shared cab phone's Lock Screen. */
export async function clearGlance(): Promise<void> {
  pushTimeline([{ at: Date.now(), props: idleProps('Off duty') }]);
  shownActivity = null;
  if (!StopActivity) return;
  await attempt(async () => {
    for (const instance of StopActivity!.getInstances()) await instance.end('immediate');
  });
}

function pushTimeline(entries: GlanceEntry[]): void {
  // The first entry's instant is "now", which moves every call; what is SHOWN is what matters.
  const key = JSON.stringify(entries.map((entry, i) => ({ at: i === 0 ? 0 : entry.at, props: entry.props })));
  if (key === lastTimeline) return;
  lastTimeline = key;
  const widget = StopWidget;
  if (!widget) return;
  void attempt(() => {
    if (Platform.OS === 'ios') {
      widget.updateTimeline(entries.map((entry) => ({ date: new Date(entry.at), props: entry.props })));
    } else {
      widget.updateSnapshot(entries[0]!.props);
    }
  });
}

function pushActivity(load: Load | null, now: number): void {
  if (!StopActivity) return;
  const factory = StopActivity;
  void attempt(async () => {
    const running = factory.getInstances();
    const command = activityCommand({ running: running.length > 0, shown: shownActivity, load, now });
    switch (command.kind) {
      case 'none':
        return;
      case 'start': {
        const staleAt = command.staleAt === null ? undefined : new Date(command.staleAt);
        factory.start(command.props, command.props.url, staleAt);
        shownActivity = command.props;
        return;
      }
      case 'update': {
        const staleAt = command.staleAt === null ? undefined : new Date(command.staleAt);
        // One activity is the rule; a second left by an older build is ended rather than updated.
        const [first, ...extra] = running;
        await first!.update(command.props, staleAt);
        for (const instance of extra) await instance.end('immediate');
        shownActivity = command.props;
        return;
      }
      case 'end':
        for (const instance of running) await instance.end('default');
        shownActivity = null;
        return;
    }
  });
}

async function attempt(work: () => void | Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (__DEV__ && !warned) {
      warned = true;
      console.warn('[glance] the widget or Live Activity could not be updated:', error);
    }
  }
}
