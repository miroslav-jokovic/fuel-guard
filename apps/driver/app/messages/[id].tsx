import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  MESSAGE_REPORT_LABELS,
  MESSAGE_REPORT_REASONS,
  messageBody,
  threadTitle,
  type Message,
  type MessageReportReason,
} from '@silvicom/shared';
import {
  ActionBar,
  AppText,
  Banner,
  Button,
  ConfirmSheet,
  GroupedList,
  Input,
  ListRow,
  OfflineBanner,
  Screen,
  ScreenHeader,
  SectionLabel,
  Skeleton,
} from '@/components';
import {
  useMarkThreadRead,
  useMessagesRealtime,
  useReportMessage,
  useSendMessage,
  useThreadDetail,
} from '@/features/messages/useMessages';
import { useSession } from '@/session/SessionProvider';
import { haptics } from '@/lib/haptics';
import { useFeatures } from '@/session/useFeatures';

function MessageBubble({
  message,
  mine,
  onReport,
}: {
  message: Message;
  mine: boolean;
  onReport: () => void;
}) {
  const content = (
    <>
      {!mine && message.sender_name ? (
        <AppText variant="caption" tone="secondary" className="pb-0.5 font-semibold">{message.sender_name}</AppText>
      ) : null}
      <AppText
        variant="body"
        tone={mine ? 'inverse' : 'primary'}
        className={message.deleted_at ? 'italic' : ''}
      >
        {messageBody(message)}
      </AppText>
      <AppText
        variant="caption"
        tone={mine ? 'inverse' : 'subtle'}
        tabular
        className="pt-0.5 text-right"
      >
        {new Date(message.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
      </AppText>
    </>
  );

  const className = `max-w-[80%] rounded-xl px-3 py-2 ${mine ? 'self-end bg-brand' : 'self-start bg-surface-muted'}`;
  if (mine) return <View className={className}>{content}</View>;

  return (
    <Pressable
      onLongPress={onReport}
      delayLongPress={400}
      accessibilityRole="button"
      accessibilityHint="Long press or use the Report action to report this message"
      accessibilityActions={[{ name: 'report', label: 'Report message' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'report') onReport();
      }}
      className={`${className} active:opacity-80`}
    >
      {content}
    </Pressable>
  );
}

/**
 * One conversation (Phase 7). Replies ride the outbox (typed in a dead zone → lands on reconnect);
 * inbound rides Realtime with the poll as fallback. Long-press any received message to REPORT it
 * (Apple 1.2 UGC affordance) — reasons from the shared vocabulary, recorded and audited for the
 * fleet to act on. Messages can't be deleted; a retracted one renders as "Message removed".
 */
export default function ThreadScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useSession();
  const features = useFeatures();
  const messagesEnabled = features.enabled('messages');
  const q = useThreadDetail(id, messagesEnabled);
  const send = useSendMessage(id);
  const markRead = useMarkThreadRead();
  const report = useReportMessage();
  const [draft, setDraft] = useState('');
  const [reporting, setReporting] = useState<Message | null>(null);
  const [reportReason, setReportReason] = useState<MessageReportReason | null>(null);
  const scroller = useRef<ScrollView>(null);
  useMessagesRealtime(id, messagesEnabled);

  // An open conversation is a read conversation — once, when it loads, and again on new messages.
  const messageCount = q.data?.messages.length ?? 0;
  useEffect(() => {
    if (messagesEnabled && id && messageCount > 0) markRead.mutate(id);
    scroller.current?.scrollToEnd({ animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- markRead is a stable mutation handle
  }, [id, messageCount, messagesEnabled]);

  const thread = q.data?.thread;
  const messages = q.data?.messages ?? [];

  if (features.isLoaded && !messagesEnabled) return <Redirect href="/home" />;
  if (!features.isLoaded) {
    return (
      <Screen padTop={false}>
        <ScreenHeader title="Conversation" onBack={() => router.back()} />
        <Skeleton className="h-[48px] w-3/4 rounded-xl" />
      </Screen>
    );
  }

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    await send.mutateAsync(body);
    setDraft('');
    haptics.select();
  };

  const submitReport = async () => {
    if (!reporting || !reportReason) return;
    try {
      await report.mutateAsync({ messageId: reporting.id, reason: reportReason });
      haptics.success();
    } finally {
      setReporting(null);
      setReportReason(null);
    }
  };

  return (
    <Screen
      scroll={false}
      padTop={false}
      footer={
        <ActionBar>
          <View className="flex-row items-center gap-2">
            <View className="flex-1">
              <Input
                accessibilityLabel="Message"
                placeholder="Type a message…"
                value={draft}
                onChangeText={setDraft}
                returnKeyType="send"
                onSubmitEditing={() => void submit()}
              />
            </View>
            <Button label="Send" disabled={!draft.trim() || send.isPending} onPress={() => void submit()} />
          </View>
          <AppText variant="caption" tone="subtle" className="pb-1 text-center">
            Works offline — replies send when you get signal.
          </AppText>
        </ActionBar>
      }
    >
      <ScreenHeader
        title={thread ? threadTitle(thread, userId ?? '') : 'Conversation'}
        subtitle={thread?.load_ref ? `About load ${thread.load_ref}` : undefined}
        onBack={() => router.back()}
      />
      <OfflineBanner />

      {q.isError && !q.data ? (
        <Banner
          tone="danger"
          message={q.error.message || 'Could not load the conversation.'}
          actionLabel="Retry"
          onAction={() => void q.refetch()}
        />
      ) : null}

      {q.isPending && !q.data ? (
        <View className="gap-2">
          <Skeleton className="h-[48px] w-3/4 rounded-xl" />
          <Skeleton className="h-[48px] w-2/3 self-end rounded-xl" />
        </View>
      ) : (
        <ScrollView
          ref={scroller}
          className="flex-1"
          contentContainerStyle={{ gap: 8, paddingVertical: 8 }}
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
        >
          {messages.map((m) => {
            const mine = m.sender_user_id === userId;
            return (
              <MessageBubble
                key={m.id}
                message={m}
                mine={mine}
                onReport={() => setReporting(m)}
              />
            );
          })}
          {messages.length === 0 ? (
            <AppText variant="supporting" tone="muted" className="py-6 text-center">No messages yet.</AppText>
          ) : null}
        </ScrollView>
      )}

      {/* Report sheet: pick a reason, then confirm. */}
      {reporting && !reportReason ? (
        <View className="gap-2">
          <SectionLabel compact>Report this message</SectionLabel>
          <GroupedList>
            {MESSAGE_REPORT_REASONS.map((r) => (
              <ListRow key={r} title={MESSAGE_REPORT_LABELS[r]} icon="report" onPress={() => setReportReason(r)} />
            ))}
          </GroupedList>
          <Button label="Cancel" variant="secondary" onPress={() => setReporting(null)} />
        </View>
      ) : null}
      <ConfirmSheet
        visible={reporting !== null && reportReason !== null}
        tone="danger"
        icon="report"
        title="Report this message?"
        message={`It will be flagged to your fleet as "${reportReason ? MESSAGE_REPORT_LABELS[reportReason] : ''}". The sender isn't notified.`}
        confirmLabel="Report"
        loading={report.isPending}
        onConfirm={() => void submitReport()}
        onCancel={() => {
          setReporting(null);
          setReportReason(null);
        }}
      />
    </Screen>
  );
}
