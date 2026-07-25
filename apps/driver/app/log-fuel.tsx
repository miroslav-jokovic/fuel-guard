import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Screen } from '@/components';

export default function LogFuel() {
  const router = useRouter();
  return (
    <Screen>
      <View className="flex-row items-center justify-between">
        <Text className="text-xl font-bold text-ink">Log fill-up</Text>
        <Button label="Close" icon="close" variant="ghost" size="sm" onPress={() => router.back()} />
      </View>
      <Card>
        <Text className="text-ink-secondary">
          The 30-second capture flow — vehicle, odometer, gallons, cost, receipt, with live warnings —
          is built in Phase 3. This modal is its entry point in the shell.
        </Text>
      </Card>
    </Screen>
  );
}
