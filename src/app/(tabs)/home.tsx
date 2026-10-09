import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner } from '@/components/banner';
import { Card } from '@/components/card';
import { ChildSwitcher } from '@/components/child-switcher';
import { Blob, Ring } from '@/components/decor';
import { EmptyState } from '@/components/empty-state';
import { FeatureTile } from '@/components/feature-tile';
import { Icon } from '@/components/icon';
import { ListGroup, ListRow } from '@/components/list-group';
import { Mascot } from '@/components/mascot';
import { Screen } from '@/components/screen';
import { SectionHeader } from '@/components/section-header';
import { StreakCounter, StreakLegend, StreakWeek } from '@/components/streak';
import { SyncStatusPill } from '@/components/sync-status-pill';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { useSyncStatus } from '@/core/sync/use-sync-status';
import { palette } from '@/core/theme';
import { brushingWindows } from '@/domain/brushing-windows';
import { useMockData } from '@/mock/store';
import { currentWeek, streakCount } from '@/mock/streak';
import { formatClock, formatDateTime } from '@/ui/format';

const t = id.home;

function greeting(now: Date) {
  const h = now.getHours();
  if (h < 11) return t.greetingMorning;
  if (h < 18) return t.greetingDay;
  return t.greetingEvening;
}

function SlotStatus({
  label,
  icon,
  done,
  window,
}: {
  label: string;
  icon: 'wb-sunny' | 'nightlight-round';
  done: boolean;
  window: string;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${done ? t.slotDone : window}`}
      className="flex-1 flex-row items-center gap-2 rounded-2xl bg-primary-deep p-3"
    >
      <Icon name={icon} size={22} color={palette.accent} />
      <View className="flex-1">
        <Text variant="label">{label}</Text>
        <View className="flex-row items-center gap-1">
          {done ? <Icon name="check-circle" size={16} color={palette.accent} /> : null}
          <Text variant="caption">{done ? t.slotDone : window}</Text>
        </View>
      </View>
    </View>
  );
}

export default function Home() {
  const insets = useSafeAreaInsets();
  const sync = useSyncStatus();
  const kids = useMockData((s) => s.kids);
  const activeId = useMockData((s) => s.activeChildId);
  const setActive = useMockData((s) => s.setActiveChild);
  const allBrushing = useMockData((s) => s.brushing);

  const kid = kids.find((k) => k.id === activeId) ?? null;
  const records = allBrushing.filter((r) => r.childId === kid?.id);
  const week = currentWeek(records);
  const today = week.find((d) => d.isToday);
  const last = records.reduce<(typeof records)[number] | null>(
    (latest, r) => (!latest || r.startedAt > latest.startedAt ? r : latest),
    null,
  );
  const w = brushingWindows;

  return (
    <Screen className="pt-0">
      {/* Greeting block (no navigation bar on the home tab, like the reference). */}
      <View className="gap-3" style={{ paddingTop: insets.top + 12 }}>
        <View className="flex-row items-center justify-between gap-3">
          <Text variant="body" tone="secondary" className="shrink">
            {greeting(new Date())}
          </Text>
          <SyncStatusPill status={sync} />
        </View>
        <Text variant="display" accessibilityRole="header">
          {kid ? t.subtitle(kid.nickname) : t.subtitleNoChild}
        </Text>
        <ChildSwitcher kids={kids} activeId={activeId} onChange={setActive} />
      </View>

      <Banner tone="info" message={id.common.previewData} />

      {kid ? (
        <Card tone="blue" className="gap-5 p-6" testID="streak-card">
          <Blob color={palette.coral} size={150} variant={0} style={{ right: -50, top: -50 }} />
          <Blob color={palette.primaryDeep} size={200} variant={2} opacity={0.7} style={{ left: -90, bottom: -120 }} />
          <Ring color={palette.accent} size={46} thickness={8} style={{ right: 118, top: 14 }} />
          <View className="flex-row items-center justify-between">
            <View className="gap-2">
              <Text variant="label">{t.streakTitle}</Text>
              <StreakCounter count={streakCount(records)} />
            </View>
            <Mascot size={104} withBrush />
          </View>
          <Text variant="caption">{t.streakHint}</Text>
          <StreakWeek days={week} />
          <StreakLegend />
          <View className="flex-row gap-2">
            <SlotStatus label={t.todayMorning} icon="wb-sunny" done={!!today?.morning} window={t.slotWindow(w.morning.start, w.morning.end)} />
            <SlotStatus label={t.todayEvening} icon="nightlight-round" done={!!today?.evening} window={t.slotWindow(w.evening.start, w.evening.end)} />
          </View>
          <Button
            title={t.startBrushing}
            icon="play-arrow"
            variant="accent"
            size="large"
            onPress={() => router.push('/brushing/session')}
          />
        </Card>
      ) : (
        <EmptyState
          mascot="thinking"
          title={t.emptyTitle}
          message={t.emptyBody}
          action={{ label: t.emptyAction, onPress: () => router.push('/profile/child/new') }}
        />
      )}

      <View className="gap-3">
        <SectionHeader title={t.featuresTitle} action={{ label: t.seeAll, onPress: () => router.push('/features') }} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-5" contentContainerClassName="gap-3 px-5">
          <FeatureTile compact style={{ width: 170 }} icon="timer" tone="blue" title={id.features.brushing.title} onPress={() => router.push('/brushing/session')} />
          <FeatureTile compact style={{ width: 170 }} icon="opacity" tone="sun" title={id.features.toothpaste.title} onPress={() => router.push('/feature/toothpaste')} />
          <FeatureTile compact style={{ width: 170 }} icon="menu-book" tone="coral" title={id.features.education.title} onPress={() => router.push('/feature/education')} />
          <FeatureTile compact style={{ width: 170 }} icon="photo-camera" tone="lavender" title={id.features.screening.title} status="soon" statusLabel={id.common.soon} />
        </ScrollView>
      </View>

      <Card tone="cream" className="flex-row items-center gap-4">
        <Mascot size={72} mood="wow" />
        <View className="flex-1 gap-1">
          <Text variant="headline">{t.reminderTitle}</Text>
          <Text variant="caption" tone="secondary">
            {t.reminderBody}
          </Text>
        </View>
      </Card>

      {kid ? (
        <ListGroup title={t.recentTitle}>
          <ListRow
            icon="timer"
            iconTone="blue"
            title={t.lastBrushing}
            subtitle={last ? formatDateTime(last.startedAt) : t.noBrushingYet}
            value={last ? formatClock(last.durationS) : undefined}
            onPress={last ? () => router.push(`/history/${last.id}`) : undefined}
          />
        </ListGroup>
      ) : null}
    </Screen>
  );
}
