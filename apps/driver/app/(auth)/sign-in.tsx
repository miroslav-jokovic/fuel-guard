import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthError } from '@supabase/supabase-js';
import { Banner, Button, Field, Icon, Input } from '@/components';
import { AuthHero } from '@/features/auth/AuthLayout';
import { useSession } from '@/session/SessionProvider';

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
  if (e instanceof Error && e.message) return e.message; // exchange endpoint copy is already friendly
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
        contentContainerClassName="flex-grow justify-center px-6 gap-7"
        contentContainerStyle={{ paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <AuthHero
          icon="local_gas_station"
          title="FuelGuard Driver"
          subtitle="Sign in with the Driver ID your fleet gave you."
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
                hitSlop={8}
                className="absolute inset-y-0 right-3 justify-center"
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
        <Text className="text-center text-sm leading-relaxed text-ink-muted">
          No login yet, or forgot your password? Ask dispatch — they issue and reset Driver IDs.
        </Text>

        {__DEV__ ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => activateDevBypass()}
            className="items-center py-3"
          >
            <Text className="text-xs text-ink-subtle">⚡ Dev bypass (skip auth)</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
