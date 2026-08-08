import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthError } from '@supabase/supabase-js';
import { AppText, Banner, Button, Field, Icon, Input } from '@/components';
import { AuthHero } from '@/features/auth/AuthLayout';
import { useSession } from '@/session/SessionProvider';
import { layout } from '@/theme/tokens';

/** Map Supabase auth errors to plain, non-leaky copy (never echo raw provider strings to drivers). */
function friendlyError(e: unknown): string {
  if (e instanceof AuthError) {
    if (e.message.toLowerCase().includes('invalid login')) {
      return 'That Driver ID or password is incorrect.';
    }
    if (e.status === 0 || e.message.toLowerCase().includes('network')) {
      return 'Can’t reach the server. Check your connection and try again.';
    }
  }
  if (e instanceof Error && e.message) {
    const message = e.message.toLowerCase();
    // React Native/Expo surfaces transport failures as ordinary TypeErrors, sometimes wrapping the
    // native exception text. Never expose that implementation detail in the driver-facing banner.
    if (
      message.includes('fetch failed') ||
      message.includes('failed to fetch') ||
      message.includes('network request failed') ||
      message.includes('could not connect to the server')
    ) {
      return 'Can’t reach the server. Check your connection and try again.';
    }
    return e.message; // exchange endpoint copy is already friendly
  }
  return 'Something went wrong signing in. Please try again.';
}

export default function SignIn() {
  const { signIn, activateDevBypass } = useSession();
  const insets = useSafeAreaInsets();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = username.trim().length > 0 && password.length > 0 && !submitting;

  async function onSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await signIn(username.trim(), password);
      // On success the session flips and the root guard navigates away — nothing to do here.
    } catch (e) {
      setError(friendlyError(e));
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-canvas"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerClassName="flex-grow gap-4 px-4"
        contentContainerStyle={{ paddingTop: insets.top + layout.sectionGap, paddingBottom: insets.bottom + layout.sectionGap }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <AuthHero
          icon="local_gas_station"
          title="Sign in"
          subtitle="Use the Driver ID issued by your fleet."
        />

        {error ? <Banner tone="danger" message={error} /> : null}

        <View className="gap-4">
          <Field label="Driver ID">
            <Input
              value={username}
              onChangeText={setUsername}
              placeholder="e.g. aaron.cole"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              returnKeyType="next"
              editable={!submitting}
            />
          </Field>

          <Field label="Password">
            <View className="relative justify-center">
              <Input
                value={password}
                onChangeText={setPassword}
                placeholder="Your password"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="current-password"
                textContentType="password"
                secureTextEntry={!showPassword}
                returnKeyType="go"
                editable={!submitting}
                onSubmitEditing={() => {
                  void onSubmit();
                }}
                style={{ paddingRight: 48 }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                onPress={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 w-12 items-center justify-center"
              >
                <Icon
                  name={showPassword ? 'visibility_off' : 'visibility'}
                  size={22}
                  className="text-ink"
                />
              </Pressable>
            </View>
          </Field>

          <Button
            label="Sign in"
            variant="primary"
            icon="login"
            loading={submitting}
            disabled={!canSubmit}
            onPress={() => {
              void onSubmit();
            }}
          />
        </View>

        {/* No self-service recovery by design (DRIVER-CREDENTIALS-PLAN.md DC3): logins are
            company-issued; a forgotten password is reset by dispatch, never by email. */}
        <AppText variant="supporting" tone="muted">
          No login yet, or forgot your password? Ask dispatch — they issue and reset Driver IDs.
        </AppText>

        {__DEV__ ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => activateDevBypass()}
            className="min-h-11 items-center justify-center px-3"
          >
            <AppText variant="caption" tone="subtle">Development bypass</AppText>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
