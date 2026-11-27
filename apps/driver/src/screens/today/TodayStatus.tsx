import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { NextStep, StatusBlock, useToast } from '@/components';
import { useCompleteStop } from '@/features/loads/useLoads';
import type { NextStepView, StatusBlockView } from './todayStatusModel';

/**
 * The top of Today: the status block (the screen's one signature, D-DV6) and, under it, the one next
 * step (Uber's "recommended next step"). The words are `todayStatusModel`; this wires the actions.
 *
 * "Arrived" is the stop screen's own "Mark arrived": `useCompleteStop` with `status: 'arrived'`,
 * queued in the outbox so it works in a dead zone and replays safely (the server treats a repeat of
 * the same status as a no-op, migration 0141). Finishing a stop is never done from here, because
 * finishing with a missing photo needs D21's reason step, which lives on the stop screen.
 */
export function TodayStatus({
  status,
  next,
  openLoadId,
}: {
  status: StatusBlockView;
  next: NextStepView | null;
  /** The block opens this load when pressed. */
  openLoadId?: string;
}) {
  const router = useRouter();
  const complete = useCompleteStop();
  const toast = useToast();

  const run = (step: NextStepView) => {
    const action = step.action;
    if (action.kind === 'openLoad') {
      router.push(`/loads/${action.loadId}` as never);
      return;
    }
    if (action.kind === 'openStop') {
      router.push(`/loads/${action.loadId}/stop/${action.stopId}` as never);
      return;
    }
    complete.mutate(
      { loadId: action.loadId, stopId: action.stopId, status: 'arrived' },
      {
        onSuccess: () => toast.show(`${status.subject ?? 'Stop'} marked arrived`),
        onError: (e) => toast.show(e instanceof Error ? e.message : 'Could not save. Try again from the stop.', 'danger'),
      },
    );
  };

  return (
    <View className="gap-3">
      <StatusBlock
        context={status.context}
        subject={status.subject}
        place={status.place}
        figure={status.figure}
        figureSuffix={status.figureSuffix}
        live={status.live}
        liveTone={status.liveTone}
        accessibilityLabel={[status.context, status.subject, status.place, status.figure, status.figureSuffix, status.live]
          .filter(Boolean)
          .join(', ')}
        onPress={openLoadId ? () => router.push(`/loads/${openLoadId}` as never) : undefined}
      />
      {next ? (
        <NextStep
          title={next.title}
          reason={next.reason}
          actionLabel={next.actionLabel}
          loading={next.action.kind === 'arrive' && complete.isPending}
          onAction={() => run(next)}
        />
      ) : null}
    </View>
  );
}
