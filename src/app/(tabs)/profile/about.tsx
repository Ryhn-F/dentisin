import Constants from 'expo-constants';
import { router } from 'expo-router';
import { View } from 'react-native';

import { Card } from '@/components/card';
import { HeroHeader } from '@/components/hero-header';
import { ListGroup, ListRow } from '@/components/list-group';
import { Mascot } from '@/components/mascot';
import { Screen } from '@/components/screen';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { triageRules } from '@/domain/triage';

const t = id.about;

export default function About() {
  return (
    <Screen flush>
      <HeroHeader>
        <View className="items-center gap-2">
          <Mascot size={120} />
          <Text variant="display">{id.appName}</Text>
          <Text variant="body">{t.tagline}</Text>
        </View>
      </HeroHeader>

      <View className="gap-6 px-5">
        <ListGroup>
          <ListRow icon="smartphone" iconTone="blue" title={t.version} value={Constants.expoConfig?.version ?? '-'} />
          <ListRow icon="rule" iconTone="sun" title={t.rulesVersion} value={triageRules.version} />
          <ListRow icon="memory" iconTone="coral" title={t.modelVersion} value={t.none} />
        </ListGroup>

        <Card tone="sky">
          <Text variant="body">{t.screeningNote}</Text>
        </Card>

        <ListGroup title={t.licensesTitle}>
          <ListRow icon="code" title={t.licensesBody} />
          <ListRow icon="text-fields" title={t.fontLicense} />
        </ListGroup>

        {__DEV__ ? (
          <ListGroup>
            <ListRow icon="palette" iconTone="coral" title={t.devTheme} onPress={() => router.push('/dev/theme')} />
          </ListGroup>
        ) : null}
      </View>
    </Screen>
  );
}
