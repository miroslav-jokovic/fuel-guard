import { View } from 'react-native';
import { AppText, Button, Card } from '@/components';

/**
 * The pre-shift and between-loads hero. B6.1 replaces this with the one-tap "same rig as yesterday"
 * card; until then it is the existing confirm-equipment action in its Direction B form.
 */
export function StartDayCard({
  onDuty,
  onStart,
  onChange,
}: {
  onDuty: boolean;
  onStart: () => void;
  onChange: () => void;
}) {
  return (
    <Card variant="hero">
      <AppText variant="label" tone="onHeroSecondary">{onDuty ? 'NO LOAD IN PROGRESS' : 'START YOUR DAY'}</AppText>
      <AppText variant="screenTitle" tone="onHero">
        {onDuty ? 'Nothing to drive yet' : 'Confirm your equipment'}
      </AppText>
      <AppText variant="supporting" tone="onHeroSecondary">
        {onDuty
          ? 'You are on duty. A released load will appear here the moment dispatch sends it.'
          : 'Tell us the truck and trailer you are using, and the day starts.'}
      </AppText>
      <View className="pt-1">
        <Button
          label={onDuty ? 'Change truck or trailer' : 'Confirm equipment'}
          icon={onDuty ? 'route' : 'play_circle'}
          variant={onDuty ? 'secondary' : 'hero'}
          size="lg"
          onHero={onDuty}
          onPress={onDuty ? onChange : onStart}
        />
      </View>
    </Card>
  );
}
