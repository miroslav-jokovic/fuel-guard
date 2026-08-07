import { useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { messagePreview, sortThreads, threadTitle } from '@fuelguard/shared';
import {
  ActionBar,
  AppText,
  Badge,
  Banner,
  Button,
  EmptyState,
  GroupedList,
  Input,
  ListRow,
  OfflineBanner,
  Screen,
  ScreenHeader,
  SectionLabel,
  Skeleton,
} from '@/components';
import { useMessagesRealtime, useStartThread, useThreads } from '@/features/messages/useMessages';
import { useFeatures } from '@/session/useFeatures';
import { useSession } from '@/session/SessionProvider';

/**
 * Messages inbox (Phase 7, D54/D-PM4). Unread-first thread list; "Message dispatch" starts a new
 * conversation — the server resolves who's on the other end, the driver never picks recipients.
 * Works offline end-to-end: the list renders from the persisted cache and a new conversation rides
 * the outbox.
 */
export default function MessagesInbox() {
  const router = useRouter();
  const features = useFeatures();
  const { userId } = useSession();
  const threads = useThreads(features.enabled('messages'));
  const startThread = useStartThread();
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  useMessagesRealtime();

  if (features.isLoaded && !features.enabled('messages')) return <Redirect href="/home" />;

  const rows = sortThreads(threads.data?.threads ?? []);
  const showSkeletons = threads.isPending && !threads.data;

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    const threadId = await startThread.mutateAsync({ body });
    setDraft('');
    setComposing(false);
    router.push(`/messages/${threadId}` as never);
  };

  return (
    <Screen
      padTop={false}
      footer={
        composing ? (
          <ActionBar>
            <Input
              placeholder="Message dispatch…"
              value={draft}
              onChangeText={setDraft}
              autoFocus
              returnKeyType="send"
              onSubmitEditing={() => void send()}
            />
            <Button
              label="Send"
              size="lg"
              icon="mail"
              disabled={!draft.trim() || startThread.isPending}
              onPress={() => void send()}
            />
          </ActionBar>
        ) : (
          <ActionBar>
            <Button label="Message dispatch" size="lg" icon="mail" onPress={() => setComposing(true)} />
            <AppText variant="caption" tone="subtle" className="pb-1 text-center">
              Works offline — it sends when you get signal.
            </AppText>
          </ActionBar>
        )
      }
    >
      <ScreenHeader title="Messages" subtitle="You and dispatch" onClose={() => router.back()} />
      <OfflineBanner />

      {threads.isError && !threads.data ? (
        <Banner
          tone="danger"
          message={threads.error.message || 'Could not load messages.'}
          actionLabel="Retry"
          onAction={() => void threads.refetch()}
        />
      ) : null}

      <SectionLabel>Conversations</SectionLabel>
      {showSkeletons ? (
        <>
          <Skeleton className="h-[60px] w-full rounded-xl" />
          <Skeleton className="h-[60px] w-full rounded-xl" />
        </>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="mail"
          title="No messages yet"
          subtitle="Start a conversation below — dispatch sees it on their dashboard."
        />
      ) : (
        <GroupedList>
          {rows.map((t) => (
            <ListRow
              key={t.id}
              icon="mail"
              iconFill={t.unread > 0}
              title={threadTitle(t, userId ?? '')}
              subtitle={messagePreview(t.last_message)}
              onPress={() => router.push(`/messages/${t.id}` as never)}
              right={t.unread > 0 ? <Badge label={String(t.unread)} tone="brand" /> : undefined}
            />
          ))}
        </GroupedList>
      )}
      {composing ? (
        <Banner tone="info" message="Your message opens a conversation with your fleet’s dispatch team." />
      ) : null}
    </Screen>
  );
}
