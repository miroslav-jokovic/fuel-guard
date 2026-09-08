import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppText, Avatar, Banner, Card, ConfirmSheet, Icon, ListRow, Screen, ScreenHeader, Section } from '@/components';
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

      <Section first>
        {shift.isError && !shift.data ? (
          <Banner
            tone="danger"
            message="Could not verify your current shift."
            actionLabel="Retry"
            onAction={() => void shift.refetch()}
          />
        ) : null}
        <Card padded={false}>
          <View className="flex-row items-center gap-3 px-4 py-4">
            <Avatar name={name} size={48} />
            <View className="flex-1 gap-0.5">
              <AppText variant="rowTitle" numberOfLines={1}>{name}</AppText>
              <AppText variant="supporting" tone="muted" numberOfLines={1}>
                {[email, role ? `Role: ${role}` : null].filter(Boolean).join(' · ')}
              </AppText>
            </View>
          </View>
          <View className="ml-4 h-px bg-edge-subtle" />
          <ListRow
            icon="badge"
            disc="neutral"
            title="Company-issued login"
            subtitle="Your fleet manages this account. Ask your fleet manager to change or close it."
          />
          <View className="ml-18 h-px bg-edge-subtle" />
          <ListRow
            icon="logout"
            disc="danger"
            title="Sign out"
            destructive
            onPress={() => { void signOutWithRevoke(); }}
          />
          {/*
            Close my account (P4.3, Apple 5.1.1(ix)). Below Sign out and visually identical to it in
            weight, which is deliberate: this is not a feature to advertise, and a driver who wants
            it will look here. The confirm sheet does the work of making the consequence plain.
          */}
          <View className="ml-18 h-px bg-edge-subtle" />
          <ListRow
            icon="dangerous"
            disc="danger"
            title="Close my account"
            subtitle="Your login stops working right away"
            destructive
            onPress={() => setConfirmingClose(true)}
          />
        </Card>
      </Section>

      {scoreEnabled || messagesEnabled || notificationsEnabled ? (
        <Section title="Work">
          <Card padded={false}>
            {scoreEnabled ? (
              <ListRow
                title="Driver score"
                subtitle="Your week, what made the grade, and the next opportunity"
                icon="speed"
                disc="success"
                onPress={() => router.push('/score')}
              />
            ) : null}
            {scoreEnabled && messagesEnabled ? <View className="ml-18 h-px bg-edge-subtle" /> : null}
            {messagesEnabled ? (
              <ListRow
                title="Messages"
                subtitle="You and dispatch"
                icon="mail"
                disc="info"
                onPress={() => router.push('/messages')}
              />
            ) : null}
            {(scoreEnabled || messagesEnabled) && notificationsEnabled ? <View className="ml-18 h-px bg-edge-subtle" /> : null}
            {notificationsEnabled ? (
              <ListRow
                title="Notifications"
                subtitle="Everything dispatch has sent you"
                icon="notifications"
                disc="neutral"
                onPress={() => router.push('/notifications')}
              />
            ) : null}
          </Card>
        </Section>
      ) : null}

      <Section title="Settings">
        <Card padded={false}>
          <ListRow
            title="System settings"
            subtitle="Appearance, contrast, sync and build"
            icon="settings"
            disc="neutral"
            onPress={() => router.push('/settings')}
          />
          {hazmatEnabled ? (
            <>
              <View className="ml-18 h-px bg-edge-subtle" />
              <ListRow
                title="Scanner settings"
                subtitle="How documents are captured on this phone"
                icon="qr_code_scanner"
                disc="action"
                onPress={() => router.push('/scanner-settings')}
              />
            </>
          ) : null}
          {__DEV__ ? (
            <>
              <View className="ml-18 h-px bg-edge-subtle" />
              <ListRow
                title="Design system"
                subtitle="Component gallery · development builds"
                icon="explore"
                disc="neutral"
                onPress={() => router.push('/gallery')}
              />
            </>
          ) : null}
        </Card>
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
        <Card padded={false}>
          <ListRow
            title="Privacy policy"
            subtitle="What the app collects, and what it does not"
            icon="shield"
            disc="neutral"
            right={<Icon name="open_in_new" size={18} className="text-ink-subtle" />}
            onPress={() => { void openLegalDocument('privacy'); }}
          />
          <View className="ml-18 h-px bg-edge-subtle" />
          <ListRow
            title="Terms of use"
            subtitle="The rules for using this app"
            icon="task_alt"
            disc="neutral"
            right={<Icon name="open_in_new" size={18} className="text-ink-subtle" />}
            onPress={() => { void openLegalDocument('terms'); }}
          />
          <View className="ml-18 h-px bg-edge-subtle" />
          <ListRow
            title="Support"
            subtitle="What to try first, and who to ask"
            icon="help"
            disc="neutral"
            right={<Icon name="open_in_new" size={18} className="text-ink-subtle" />}
            onPress={() => { void openLegalDocument('support'); }}
          />
        </Card>
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
