import { Stack, useLocalSearchParams } from 'expo-router';

import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { id } from '@/core/i18n/id';

const t = id.education;

// Card content must come from guidelines with sources and dentist review (PRD FR-70);
// until then the card says so instead of showing unreviewed health text.
export default function EducationCard() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const card = t.cards[slug as keyof typeof t.cards];
  return (
    <Screen>
      <Stack.Screen options={{ title: card?.title ?? t.title }} />
      <EmptyState mascot="thinking" title={t.pendingTitle} message={t.pendingBody} />
    </Screen>
  );
}
