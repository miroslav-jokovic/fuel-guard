import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useURL } from 'expo-linking';
import { Banner, Button, Field, Icon, Input } from '@/components';
import { AuthHero } from '@/features/auth/AuthLayout';
import { useSession } from '@/session/SessionProvider';
import {
  establishSession,
  hasSessionMaterial,
  parseInviteUrl,
} from '@/features/auth/acceptInvite';
import { apiFetch } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import { roleColors } from '@/theme/colors';
import { useTheme } from '@/theme/ThemeProvider';

// Accept-invite / set-password (Phase 1 §12.5) — the RN mirror of the web's AcceptInvitePage:
// establish the session from the emailed link, set a password (updateUser), POST /api/invites/accept
// with the invite token (D15), refresh the session so org_id/user_role claims land, and let the
// root guard route to Home. Same engine, native skin.
type Step = 'verifying' | 'password' | 'finishing' | 'no-link';

const MIN_PASSWORD = 10; // D16 password policy

export default function AcceptInvite() {
  const url = useURL();
  const insets = useSafeAreaInsets();
  const { refresh, session } = useSession();
  const { isDark } = useTheme();

  const [step, setStep] = useState<Step>('verifying');
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [pastedLink, setPastedLink] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Consume whatever link opened us (cold start or foreground). Runs again if a new link arrives.
  useEffect(() => {
    if (!url || step === 'password' || step === 'finishing') return;
    const params = parseInviteUrl(url);
    if (params.inviteToken) setInviteToken(params.inviteToken);

    if (!hasSessionMaterial(params) && !params.errorDescription) {
      // Opened without credentials (e.g. from the sign-in link) — offer the paste rescue,
      // unless a session already exists (link was consumed by a previous open).
      setStep(session ? 'password' : 'no-link');
      return;
    }
    let cancelled = false;
    establishSession(params)
      .then(() => {
        if (!cancelled) setStep('password');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Something went wrong with this link.');
        setStep('no-link');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Opened with no URL at all (in-app navigation): show the rescue view.
  useEffect(() => {
    if (url === null) {
      const t = setTimeout(() => {
        setStep((s) => (s === 'verifying' ? (session ? 'password' : 'no-link') : s));
      }, 600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [url, session]);

  async function pasteInviteLink() {
    setError(null);
    const params = parseInviteUrl(pastedLink.trim());
    if (params.inviteToken) setInviteToken(params.inviteToken);
    if (!hasSessionMaterial(params)) {
      setError('That link doesn’t contain sign-in credentials. Paste the full link from your invitation email.');
      return;
    }
    setSubmitting(true);
    try {
      await establishSession(params);
      setStep('password');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong with this link.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmit() {
    setError(null);
    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const { error: pwErr } = await supabase.auth.updateUser({ password });
      if (pwErr) throw new Error('Couldn’t save your password. Please try again.');

      const res = await apiFetch('/api/invites/accept', {
        method: 'POST',
        body: inviteToken ? { token: inviteToken } : {},
      });
      if (!res.ok) {
        throw new Error(res.error?.message ?? 'Could not accept the invitation.');
      }

      setStep('finishing');
      haptics.success();
      await refresh(); // pull org_id / user_role claims — the root guard then routes to Home
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setSubmitting(false);
    }
  }

  const spinnerColor = roleColors[isDark ? 'dark' : 'light'].brand;

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-canvas"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerClassName="flex-grow justify-center px-6 gap-7"
        contentContainerStyle={{ paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {step === 'verifying' || step === 'finishing' ? (
          <View className="items-center gap-4">
            <ActivityIndicator color={spinnerColor} />
            <Text className="text-center text-base text-ink-muted">
              {step === 'verifying' ? 'Checking your invitation…' : 'Setting up your account…'}
            </Text>
          </View>
        ) : null}

        {step === 'password' ? (
          <>
            <AuthHero
              icon="badge"
              title="Set your password"
              subtitle="Finish setting up your FuelGuard Driver account."
            />
            {error ? <Banner tone="danger" message={error} /> : null}
            <View className="gap-4">
              <Field label="New password" hint={`At least ${MIN_PASSWORD} characters`}>
                <View className="relative justify-center">
                  <Input
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Choose a strong password"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="new-password"
                    textContentType="newPassword"
                    secureTextEntry={!showPassword}
                    editable={!submitting}
                    style={{ paddingRight: 48 }}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                    onPress={() => setShowPassword((v) => !v)}
                    hitSlop={8}
                    className="absolute inset-y-0 right-3 justify-center"
                  >
                    <Icon
                      name={showPassword ? 'visibility_off' : 'visibility'}
                      size={22}
                      className="text-ink-muted"
                    />
                  </Pressable>
                </View>
              </Field>
              <Field label="Confirm password">
                <Input
                  value={confirm}
                  onChangeText={setConfirm}
                  placeholder="Repeat your password"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="new-password"
                  textContentType="newPassword"
                  secureTextEntry={!showPassword}
                  editable={!submitting}
                  onSubmitEditing={() => {
                    void onSubmit();
                  }}
                />
              </Field>
              <Button
                label="Set password & continue"
                variant="primary"
                icon="check"
                loading={submitting}
                disabled={password.length === 0 || confirm.length === 0 || submitting}
                onPress={() => {
                  void onSubmit();
                }}
              />
            </View>
          </>
        ) : null}

        {step === 'no-link' ? (
          <>
            <AuthHero
              icon="mail"
              tone="info"
              title="Open your invitation"
              subtitle="Tap the link in your FuelGuard invitation email on this phone — it opens the app and sets up your account."
            />
            {error ? <Banner tone="danger" message={error} /> : null}
            <View className="gap-4">
              <Field
                label="Or paste your invitation link"
                hint="Long-press the button in the email and copy its link"
              >
                <Input
                  value={pastedLink}
                  onChangeText={setPastedLink}
                  placeholder="https://…"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!submitting}
                />
              </Field>
              <Button
                label="Continue"
                variant="primary"
                icon="arrow_forward"
                loading={submitting}
                disabled={pastedLink.trim().length === 0 || submitting}
                onPress={() => {
                  void pasteInviteLink();
                }}
              />
            </View>
            <Text className="text-center text-sm leading-relaxed text-ink-muted">
              Link expired or already used? Ask your admin to resend the invitation.
            </Text>
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
