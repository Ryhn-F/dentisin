import { router } from 'expo-router';
import { View } from 'react-native';

import { FeatureTile } from '@/components/feature-tile';
import { Screen } from '@/components/screen';
import { Text } from '@/components/ui/text';
import { flags } from '@/core/flags';
import { id } from '@/core/i18n/id';

const t = id.features;

// Bold course-card grid (design reference 1). Unavailable features say why; class
// mode appears only for the `kader` role (role lookup arrives in phase 4).
export default function Features() {
  return (
    <Screen className="gap-4">
      <Text variant="body" tone="secondary">
        {t.intro}
      </Text>
      <FeatureTile
        icon="timer"
        tone="blue"
        title={t.brushing.title}
        description={t.brushing.description}
        onPress={() => router.push('/brushing/session')}
      />
      <View className="flex-row gap-3">
        <FeatureTile
          compact
          style={{ flex: 1 }}
          icon="opacity"
          tone="sun"
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
      <FeatureTile
        icon="photo-camera"
        tone="lavender"
        title={t.screening.title}
        description={t.screening.description}
        status={flags.medical_modules ? 'active' : 'soon'}
        statusLabel={flags.medical_modules ? undefined : t.screening.status}
      />
    </Screen>
  );
}
