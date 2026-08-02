import { Button } from '@/components';
import { AuthScreen } from '@/features/auth/AuthLayout';
import { useSession } from '@/features/auth/SessionProvider';

// Defense in depth (mirrors the web's driver gate): a non-driver account somehow signed in here.
// RLS is the real boundary; this is the friendly UI stop.
export default function WrongApp() {
  const { signOut } = useSession();
  return (
    <AuthScreen
      icon="lock"
      tone="danger"
      title="This app is for drivers"
      subtitle="Your FuelGuard account manages the fleet from the web dashboard. Sign in there instead — this app only works for driver accounts."
      footer={
        <Button
          label="Sign out"
          variant="primary"
          icon="logout"
          onPress={() => {
            void signOut();
          }}
        />
      }
    />
  );
}
