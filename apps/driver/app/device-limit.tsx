import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { formatDisplayDateTime, memberDevicesResponseSchema, type MemberDevice } from '@silvicom/shared';
import { AppText, Banner, Button } from '@/components';
import { AuthScreen } from '@/features/auth/AuthLayout';
import { apiFetch } from '@/lib/api';
import { useDeviceLimited } from '@/lib/deviceLimit';
import { useSession } from '@/session/SessionProvider';

/**
 * "You are signed in on 3 devices" (INSTALLED-APP-PLAN IA-S6; the owner's ruling Q-IA14 (b), 2026-11-16) — the
 * driver app's half of the web's `/too-many-devices`.
 *
 * The API refuses a phone that does not hold one of the account's three places (403 `device_limit`) and lets
 * exactly two routes through: the person's own devices and signing one out. The root guard brings the phone
 * here when `apiFetch` sees the refusal, and takes it back to Home once a request is answered again — which is
 * what "Continue" makes. Nothing the driver queued is lost meanwhile: the outbox waits (`outcomeWhileDeviceLimited`).
 */
export default function DeviceLimit() {
  const router = useRouter();
  const limited = useDeviceLimited();
  const { signOut } = useSession();
  const [devices, setDevices] = useState<MemberDevice[]>([]);
  const [limit, setLimit] = useState(3);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch('/api/me/devices', { schema: memberDevicesResponseSchema });
    if (res.ok && res.data) {
      setDevices(res.data.devices.filter((d) => d.signed_in && !d.current && d.session_id));
      setLimit(res.data.limit);
    } else {
      setMessage({ tone: 'danger', text: res.error?.message ?? 'Could not load your devices.' });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Let in: the guard has already moved on, but say so if this screen is still showing.
  useEffect(() => {
    if (!limited && !loading) router.replace('/home');
  }, [limited, loading, router]);

  async function signOutDevice(d: MemberDevice) {
    setBusy(d.id);
    setMessage(null);
    const res = await apiFetch(`/api/me/sessions/${d.session_id}`, { method: 'DELETE' });
    setBusy(null);
    if (!res.ok && res.status !== 404) {
      setMessage({ tone: 'danger', text: res.error?.message ?? 'Could not sign that device out. Try again.' });
      return;
    }
    setMessage({ tone: 'success', text: `${d.device} is signed out. Tap Continue.` });
    await load();
  }

  async function carryOn() {
    // Any answer that is not a refusal clears the flag in apiFetch; the guard then goes Home.
    setBusy('continue');
    await apiFetch('/api/me');
    setBusy(null);
  }

  return (
    <AuthScreen
      icon="lock"
      tone="caution"
      title={`Signed in on ${limit} devices`}
      subtitle={`Your account can be signed in on ${limit} devices at once. To use this phone, sign one of the others out.`}
      footer={
        <Button
          label="Sign out of this phone instead"
          variant="ghost"
          icon="logout"
          onPress={() => {
            void signOut();
          }}
        />
      }
    >
      {message ? <Banner tone={message.tone} message={message.text} /> : null}
      {devices.map((d) => (
        <View key={d.id} className="flex-row items-center justify-between gap-3 py-2">
          <View className="flex-1">
            <AppText variant="label">{d.device}</AppText>
            <AppText variant="caption" tone="secondary">
              Last used {formatDisplayDateTime(d.last_seen_at)}
              {d.addresses[0] ? ` · ${d.addresses[0].ip}` : ''}
            </AppText>
          </View>
          <Button
            label="Sign out"
            variant="secondary"
            loading={busy === d.id}
            size="sm"
            disabled={busy !== null}
            onPress={() => {
              void signOutDevice(d);
            }}
          />
        </View>
      ))}
      {!loading && devices.length === 0 ? (
        <AppText variant="supporting" tone="secondary">A place is free now. Tap Continue.</AppText>
      ) : null}
      <Button
        label="Continue"
        variant="primary"
        loading={busy === 'continue'}
        disabled={busy !== null && busy !== 'continue'}
        onPress={() => {
          void carryOn();
        }}
      />
    </AuthScreen>
  );
}
