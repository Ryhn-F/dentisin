import { router } from 'expo-router';

import type { IconName } from '@/components/icon';
import type { IconTileTone } from '@/components/icon-tile';
import { ListGroup, ListRow } from '@/components/list-group';
import { Screen } from '@/components/screen';
import { id } from '@/core/i18n/id';

const cards = id.education.cards;
type Slug = keyof typeof cards;

const look: Record<Slug, { icon: IconName; tone: IconTileTone }> = {
  'cara-sikat': { icon: 'brush', tone: 'blue' },
  'kapan-ke-dokter': { icon: 'local-hospital', tone: 'coral' },
  fluoride: { icon: 'opacity', tone: 'sun' },
  'persiapan-kunjungan': { icon: 'event-available', tone: 'mint' },
};

export default function EducationList() {
  return (
    <Screen>
      <ListGroup>
        {(Object.keys(cards) as Slug[]).map((slug) => (
          <ListRow
            key={slug}
            icon={look[slug].icon}
            iconTone={look[slug].tone}
            title={cards[slug].title}
            subtitle={cards[slug].description}
            onPress={() => router.push(`/feature/education/${slug}`)}
          />
        ))}
      </ListGroup>
    </Screen>
  );
}
