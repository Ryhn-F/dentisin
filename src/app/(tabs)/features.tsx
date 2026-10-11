import { router } from 'expo-router';
import { View } from 'react-native';

import { FeatureTile } from '@/components/feature-tile';
import { Screen } from '@/components/screen';
import { Text } from '@/components/ui/text';
import { flags } from '@/core/flags';
import { id } from '@/core/i18n/id';

const t = id.features;

// Bold course-card grid (design reference 1). Skrining, the main feature, comes first
// and opens its tab; while it waits for the dentist's sign-off the tile says so.
// Class mode appears only for the `kader` role (role lookup arrives in phase 4).
export default function Features() {
  return (
    <Screen className="gap-4">
      <Text variant="body" tone="secondary">
        {t.intro}
      </Text>
      <FeatureTile
        testID="feature-screening"
        icon="photo-camera"
        tone="blue"
        title={t.screening.title}
        description={t.screening.description}
        statusLabel={flags.medical_modules ? undefined : id.common.soon}
        onPress={() => router.navigate('/screening')}
      />
      <FeatureTile
        icon="timer"
        tone="sun"
        title={t.brushing.title}
        description={t.brushing.description}
        onPress={() => router.push('/brushing/session')}
      />
      <View className="flex-row gap-3">
        <FeatureTile
          compact
          style={{ flex: 1 }}
          icon="opacity"
          tone="lavender"
          title={t.toothpaste.title}
          onPress={() => router.push('/feature/toothpaste')}
        />
        <FeatureTile
          compact
          style={{ flex: 1 }}
          icon="menu-book"
          tone="coral"
          title={t.education.title}
          onPress={() => router.push('/feature/education')}
        />
      </View>
    </Screen>
  );
}
