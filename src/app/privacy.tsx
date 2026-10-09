import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { Card } from '@/components/card';
import { IconTile, type IconTileTone } from '@/components/icon-tile';
import { Screen } from '@/components/screen';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';

const t = id.privacy;
const tones: IconTileTone[] = ['blue', 'sun', 'coral', 'mint'];

// Plain-language summary of backend/docs/regulatory/PRIVACY_NOTICE_DRAFT.md.
export default function Privacy() {
  return (
    <Screen>
      <Banner tone="warning" message={t.draftNote} />
      <Card className="gap-4">
        {t.points.map((point, i) => (
          <View key={point} className="flex-row items-start gap-3">
            <IconTile name="check" tone={tones[i % tones.length]} size={32} round />
            <Text variant="body" className="flex-1">
              {point}
            </Text>
          </View>
        ))}
      </Card>
    </Screen>
  );
}
