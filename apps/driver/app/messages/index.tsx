import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { messagePreview, sortThreads, threadTitle } from '@silvicom/shared';
import {
  ActionBar,
  AppText,
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  IconButton,
  Input,
  ListRow,
  OfflineBanner,
  Screen,
  ScreenHeader,
  Section,
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
  useMessagesRealtime(undefined, features.enabled('messages'));

  if (features.isLoaded && !features.enabled('messages')) return <Redirect href="/home" />;
  if (!features.isLoaded) {
    return (
      <Screen padTop={false}>
        <ScreenHeader title="Messages" onClose={() => router.back()} />
        <Skeleton className="h-15 w-full rounded-xl" />
      </Screen>
    );
  }

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
      flow="sections"
      footer={
        composing ? (
          <ActionBar>
            <View className="flex-row items-end gap-2">
              <View className="flex-1">
                <Input
                  accessibilityLabel="Message dispatch"
                  placeholder="Message dispatch…"
                  value={draft}
                  onChangeText={setDraft}
                  autoFocus
                  returnKeyType="send"
                  onSubmitEditing={() => void send()}
                />
              </View>
              <IconButton
                name="arrow_forward"
                label="Send message"
                variant="white"
                disabled={!draft.trim() || startThread.isPending}
                onPress={() => void send()}
              />
            </View>
            <AppText variant="caption" tone="subtle" className="pb-1 text-center">
              Works offline — it sends when you get signal.
            </AppText>
          </ActionBar>
        ) : (
          <ActionBar>
            <Button label="Message dispatch" size="lg" variant="primary" icon="mail" onPress={() => setComposing(true)} />
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

      <Section title="Conversations">
        {showSkeletons ? (
          <>
            <Skeleton className="w-full rounded-xl" style={{ height: 64 }} />
            <Skeleton className="w-full rounded-xl" style={{ height: 64 }} />
          </>
        ) : rows.length === 0 ? (
          <Card padded={false}>
            <EmptyState
              icon="mail"
              title="No messages yet"
              subtitle="Start a conversation below — dispatch sees it on their dashboard."
            />
          </Card>
        ) : (
          <Card padded={false}>
            {rows.map((t, index) => (
              <View key={t.id}>
                <ListRow
                  icon="mail"
                  iconFill={t.unread > 0}
                  disc="info"
                  // The sender is who a driver is looking for; the thread title is the fallback.
                  title={t.last_message?.sender_name ?? threadTitle(t, userId ?? '')}
                  subtitle={messagePreview(t.last_message)}
                  onPress={() => router.push(`/messages/${t.id}` as never)}
                  right={
                    <View className="items-end gap-1">
                      <AppText variant="caption" tone="subtle" tabular>{shortTime(t.last_message_at)}</AppText>
                      {t.unread > 0 ? <Badge label={String(t.unread)} tone="brand" /> : null}
                    </View>
                  }
                />
                {index < rows.length - 1 ? <View className="ml-18 h-px bg-edge-subtle" /> : null}
              </View>
            ))}
          </Card>
        )}
      </Section>
      {composing ? (
        <Section>
          <Banner tone="info" message="Your message opens a conversation with your fleet’s dispatch team." />
        </Section>
      ) : null}
    </Screen>
  );
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
