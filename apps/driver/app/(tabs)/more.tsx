import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppText, Banner, ConfirmSheet, GroupedList, Icon, ListRow, Screen, ScreenHeader, Section } from '@/components';
import { useThreads } from '@/features/messages/useMessages';
import { useNotifications } from '@/features/notifications/useNotifications';
import { homeScoreSummary } from '@/features/score/scoreModel';
import { useDriverScore } from '@/features/score/useDriverScore';
import { useFeatures } from '@/session/useFeatures';
import { useSession } from '@/session/SessionProvider';
import { useDriverContext } from '@/session/useDriverContext';
import { useShift } from '@/features/duty/useDuty';
import { revokePushRegistration } from '@/features/notifications/push';
import { openLegalDocument } from '@/lib/legalLinks';
import { useCloseAccount } from '@/features/account/useCloseAccount';
import { useToast } from '@/components/ToastHost';

/**
 * Everything that is not a tab, in three groups the owner named on 2026-09-07 (D-DB14): who is
 * signed in and the way out, the work surfaces that are not tabs, and the settings.
 *
 * Sign out lives HERE, on the account card, not two screens down inside System settings — a driver
 * handing a shared cab phone to the next driver should not have to hunt for it. Duty is deliberately
 * absent: Today owns the shift, and a second place to change a truck is how a driver ends up unsure
 * which screen is telling the truth (B6.4). Documents is a tab and has no row here for the same
 * reason. Notifications keeps a durable entry, because a bell that only exists on Today is
 * unreachable the moment a driver is on any other tab.
 *
 * Visual 2026 V8 (the V1 mock's screen 8): grouped rows on the canvas, like the phone's Settings app.
 * No avatar circle, no cards, no tinted icon discs; a row's glyph is neutral, and only a state is
 * coloured (D-DV5): "3 new" in cyan, Sign out in red. The mock also lists End shift and Change truck
 * here; the owner's rule that duty lives on Today only (D-DB17) outranks the mock, and Today carries
 * both as rows since V5.
 */
export default function More() {
  const router = useRouter();
  const shift = useShift();
  const driver = useDriverContext();
  const { email, role, signOut } = useSession();
  const { enabled } = useFeatures();
  const hazmatEnabled = enabled('hazmat.capture');
  const messagesEnabled = enabled('messages');
  const scoreEnabled = enabled('tab.score');
  const notificationsEnabled = enabled('notifications');

  /** Sign-out revokes this device's push token FIRST, while the session can still authenticate the
   *  call — otherwise the phone keeps receiving fleet content (D53). Best-effort with a 3s cap. */
  async function signOutWithRevoke() {
    await revokePushRegistration();
    await signOut();
  }

  const name = driver.data?.driver.full_name ?? email ?? 'Signed in';
  // The live counts at the end of the Work rows (mock screen 8): what is new, and this week's score.
  const threads = useThreads(messagesEnabled);
  const notifs = useNotifications(notificationsEnabled);
  const week = homeScoreSummary(useDriverScore(scoreEnabled).data);
  const newCount = (n: number | undefined) =>
    n && n > 0 ? <AppText variant="supporting" weight="semibold" tone="accent" tabular>{`${n} new`}</AppText> : undefined;

  /**
   * Closing the account (P4.3). The sign-out runs whether the request succeeded or not — the server
   * has already banned the login by the time it answers, so leaving the driver on a signed-in screen
   * with a dead session would be the one genuinely confusing outcome. A failure is reported first,
   * and then only the local session is cleared.
   */
  const [confirmingClose, setConfirmingClose] = useState(false);
  const closeAccount = useCloseAccount();
  const toast = useToast();

  async function confirmClose() {
    try {
      await closeAccount.mutateAsync();
    } catch (e) {
      setConfirmingClose(false);
      toast.show(
        e instanceof Error ? e.message : 'Could not close your account. Try again when you have a signal.',
        'danger',
      );
      return;
    }
    setConfirmingClose(false);
    await signOutWithRevoke();
  }

  return (
    <Screen flow="sections">
      <ScreenHeader title="More" />

      {shift.isError && !shift.data ? (
        <Section>
          <Banner
            tone="danger"
            message="Could not verify your current shift."
            actionLabel="Retry"
            onAction={() => void shift.refetch()}
          />
        </Section>
      ) : null}

      {/* Who is signed in, as a plain row (mock screen 8): the name, then what the login is. */}
      <Section>
        <View className="gap-0.5">
          <AppText variant="navigationTitle" accessibilityRole="header">{name}</AppText>
          <AppText variant="supporting" tone="secondary">
            {[role === 'driver' ? 'Driver' : role, email !== name ? email : null].filter(Boolean).join(' · ')}
          </AppText>
        </View>
      </Section>

      {scoreEnabled || messagesEnabled || notificationsEnabled ? (
        <Section title="Work">
          <GroupedList>
            {messagesEnabled ? (
              <ListRow title="Messages" icon="mail" right={newCount(threads.data?.unread_total)} onPress={() => router.push('/messages')} />
            ) : null}
            {notificationsEnabled ? (
              <ListRow title="Notifications" icon="notifications" right={newCount(notifs.data?.unread)} onPress={() => router.push('/notifications')} />
            ) : null}
            {scoreEnabled ? (
              <ListRow
                title="Driver score"
                icon="speed"
                right={week ? (
                  <AppText variant="supporting" tone="secondary" tabular>
                    {[week.scoreValue, week.rankValue !== '—' ? week.rankValue : null].filter(Boolean).join(' · ')}
                  </AppText>
                ) : undefined}
                onPress={() => router.push('/score')}
              />
            ) : null}
          </GroupedList>
        </Section>
      ) : null}

      <Section title="Settings">
        <GroupedList>
          <ListRow title="Appearance and sync" subtitle="Theme, contrast, failed syncs, app version" icon="settings" onPress={() => router.push('/settings')} />
          {hazmatEnabled ? (
            <ListRow title="Scanner" subtitle="How documents are captured on this phone" icon="qr_code_scanner" onPress={() => router.push('/scanner-settings')} />
          ) : null}
          {__DEV__ ? (
            <ListRow title="Design system" subtitle="Component gallery · development builds" icon="explore" onPress={() => router.push('/gallery')} />
          ) : null}
          {__DEV__ ? (
            <ListRow title="Live edge prototype" subtitle="Scanner outline, step L0 · development builds" icon="photo_camera" onPress={() => router.push('/live-edge')} />
          ) : null}
        </GroupedList>
      </Section>

      {/*
        About (P3.2). Both stores want their listing's privacy, terms and support URLs reachable
        from inside the app as well as from the listing, and a driver who wants to know whether the
        app tracks them should not have to find the store page to ask.

        They open in the phone's browser rather than a screen in here: these documents are published
        by the company at one address, and a copy rendered natively is a second copy that would be
        stale the day the policy changes. `legalLinks.ts` derives the address from the API base.
      */}
      <Section title="About">
        <GroupedList>
          <ListRow title="Help and contact" icon="help" right={<Icon name="open_in_new" size={18} className="text-ink-subtle" />} onPress={() => { void openLegalDocument('support'); }} />
          <ListRow title="Privacy policy" icon="shield" right={<Icon name="open_in_new" size={18} className="text-ink-subtle" />} onPress={() => { void openLegalDocument('privacy'); }} />
          <ListRow title="Terms of use" icon="task_alt" right={<Icon name="open_in_new" size={18} className="text-ink-subtle" />} onPress={() => { void openLegalDocument('terms'); }} />
        </GroupedList>
      </Section>

      {/*
        Sign out stays one tap from the tab (B6): a driver handing a shared cab phone over should not
        hunt for it. Close my account (P4.3, Apple 5.1.1(ix)) sits under it at the same weight on
        purpose: it is not a feature to advertise, and the confirm sheet makes the consequence plain.
      */}
      <Section title="Account">
        <GroupedList>
          <ListRow icon="badge" title="Company-issued login" subtitle="Your fleet manages this account. Ask your fleet manager to change it." />
          <ListRow icon="logout" title="Sign out" destructive onPress={() => { void signOutWithRevoke(); }} />
          <ListRow icon="dangerous" title="Close my account" subtitle="Your login stops working right away" destructive onPress={() => setConfirmingClose(true)} />
        </GroupedList>
      </Section>

      {/*
        The message is the whole design of this step. It says three things a driver is entitled to
        know BEFORE they confirm, in the order they matter: the login dies now, the fleet is asked to
        delete what it may, and the qualification file the law names stays. Citing §391.51 by number
        is not legalese here — it is the difference between "they kept my data" and "the regulator
        requires them to", and a driver in this industry knows that rule.
      */}
      <ConfirmSheet
        visible={confirmingClose}
        tone="danger"
        icon="dangerous"
        title="Close your account?"
        message={
          'Your login stops working right now and your fleet is asked to delete your data within 30 days. ' +
          'Federal rules (49 CFR 391.51) require your fleet to keep your driver qualification records for ' +
          'three years after you leave; those are kept. You cannot undo this from the app.'
        }
        confirmLabel="Close my account"
        loading={closeAccount.isPending}
        onConfirm={() => { void confirmClose(); }}
        onCancel={() => setConfirmingClose(false)}
      />
    </Screen>
  );
}
