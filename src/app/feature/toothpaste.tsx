import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { Card } from '@/components/card';
import { Blob } from '@/components/decor';
import { IconTile } from '@/components/icon-tile';
import { Mascot } from '@/components/mascot';
import { Screen } from '@/components/screen';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { palette } from '@/core/theme';

const t = id.toothpaste;

// Until a dentist signs off backend/recommender/rules.json, only the conservative
// generic message is shown (recommender README; app_plan.md §4.5). Phase 7 ports
// recommend.py to TS and switches to age-specific advice once approved.
export default function Toothpaste() {
  return (
    <Screen>
      <Card tone="sun" className="flex-row items-center gap-4 p-6">
        <Blob color={palette.coral} size={140} variant={1} opacity={0.35} style={{ right: -50, top: -50 }} />
        <View className="flex-1 gap-2">
          <Text variant="title">{t.title}</Text>
          <Text variant="body">{t.generic}</Text>
        </View>
        <Mascot size={88} mood="happy" />
      </Card>
      <Banner tone="warning" message={t.reviewBanner} />
      <Card className="gap-4">
        <View className="flex-row items-center gap-3">
          <IconTile name="info-outline" tone="coral" size={44} />
          <Text variant="bodyStrong" className="flex-1">
            {t.notFilling}
          </Text>
        </View>
        <View className="flex-row items-center gap-3">
          <IconTile name="local-hospital" tone="blue" size={44} />
          <Text variant="body" tone="secondary" className="flex-1">
            {t.seeDentist}
          </Text>
        </View>
      </Card>
    </Screen>
  );
}
