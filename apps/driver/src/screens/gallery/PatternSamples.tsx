import { NextStep, Section, StatusBlock } from '@/components';
import { TodaySamples } from './TodaySamples';

/**
 * The Visual 2026 screen patterns (apps/driver/DESIGN.md, "Screen patterns") with the data shapes the
 * screens give them. Its own file because the gallery is at the 500-line budget, and each new
 * pattern step adds its samples here rather than there.
 */
export function PatternSamples() {
  return (
    <>
      {/* Visual 2026 V4: the mock's two new patterns, with the data shapes Today will give them. */}
      <Section first title="Status block — the screen's signature (D-DV6)">
        <StatusBlock
          context="Pickup · stop 1 of 2 · Load 1184530"
          subject="Ardent Mills"
          place="Chicago, IL"
          figure="06:00"
          figureSuffix="– 08:00"
          live="Window opens in 18 min"
        />
        <StatusBlock context="To finish" subject="Photos for load 1184530" figure="2" figureSuffix="missing" />
      </Section>

      <Section title="Next step — one per screen">
        <NextStep title="Arrive at pickup" reason="Then the BOL and seal photos" actionLabel="Arrived" onAction={() => undefined} />
        <NextStep title="Take the seal photo" reason="Needed before you finish at Ardent Mills" actionLabel="Open stop" onAction={() => undefined} />
      </Section>

      <TodaySamples />
    </>
  );
}
