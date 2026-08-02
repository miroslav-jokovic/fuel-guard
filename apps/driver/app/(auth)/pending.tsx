import { useState } from 'react';
import { Button } from '@/components';
import { AuthScreen } from '@/features/auth/AuthLayout';
import { useSession } from '@/session/SessionProvider';

// Signed in, but no org membership/claims yet (audit B3). Usually a brief moment right after
// accepting an invite before the refreshed token carries org_id/user_role.
export default function Pending() {
  const { refresh, signOut, email } = useSession();
  const [checking, setChecking] = useState(false);

  async function check() {
    setChecking(true);
    try {
      await refresh();
    } finally {
      setChecking(false);
    }
  }

  return (
    <AuthScreen
      icon="hourglass_empty"
      tone="caution"
      title="Account almost ready"
      subtitle={
        email
          ? `You’re signed in as ${email}, but your fleet hasn’t finished setting up your access yet. This usually takes just a moment.`
          : 'Your fleet hasn’t finished setting up your access yet. This usually takes just a moment.'
      }
      footer={
        <Button
          label="Sign out"
          variant="ghost"
          icon="logout"
          onPress={() => {
            void signOut();
          }}
        />
      }
    >
      <Button
        label="Check again"
        variant="primary"
        icon="refresh"
        loading={checking}
        onPress={() => {
          void check();
        }}
      />
    </AuthScreen>
  );
}
