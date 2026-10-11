import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { ChildSwitcher } from '@/components/child-switcher';
import { EmptyState } from '@/components/empty-state';
import { HeroHeader } from '@/components/hero-header';
import { ListGroup, ListRow } from '@/components/list-group';
import { Screen } from '@/components/screen';
import { SegmentedControl } from '@/components/segmented-control';
import { StreakWeek } from '@/components/streak';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import type { BrushingRecord } from '@/domain/models';
import { useMockData } from '@/mock/store';
import { currentWeek, localDateKey } from '@/mock/streak';
import { formatClock, formatDateTime, formatMonthYear } from '@/ui/format';

const t = id.history;
type Segment = 'brushing' | 'screening' | 'referral';

// Phase 2 renders at most this many rows; phase 6 moves to a virtualized SectionList.
const MAX_ROWS = 60;

function slotLabel(slot: BrushingRecord['slot']) {
  return slot === 'morning' ? t.slotMorning : slot === 'evening' ? t.slotEvening : t.slotOther;
}

function groupByMonth(records: BrushingRecord[]) {
  const groups: { title: string; items: BrushingRecord[] }[] = [];
  for (const r of records) {
    const title = formatMonthYear(r.startedAt);
    const last = groups[groups.length - 1];
    if (last && last.title === title) last.items.push(r);
    else groups.push({ title, items: [r] });
  }
  return groups;
}

export default function History() {
  const [segment, setSegment] = useState<Segment>('brushing');
  const kids = useMockData((s) => s.kids);
  const activeId = useMockData((s) => s.activeChildId);
  const setActive = useMockData((s) => s.setActiveChild);
  const all = useMockData((s) => s.brushing);

  const records = all
    .filter((r) => r.childId === activeId)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .slice(0, MAX_ROWS);
  const week = currentWeek(records);
  const weekKeys = new Set(week.map((d) => d.date));
  const completeDays = week.filter((d) => d.morning && d.evening).length;
  const thisWeek = records.filter((r) => weekKeys.has(localDateKey(new Date(r.startedAt))));
  const average = thisWeek.length ? Math.round(thisWeek.reduce((s, r) => s + r.durationS, 0) / thisWeek.length) : 0;

  return (
    <Screen flush>
      <HeroHeader>
        <SegmentedControl<Segment>
          accessibilityLabel={t.title}
          options={[
            { value: 'brushing', label: t.segmentBrushing },
            { value: 'screening', label: t.segmentScreening },
            { value: 'referral', label: t.segmentReferral },
          ]}
          value={segment}
          onChange={setSegment}
        />
        {segment === 'brushing' && records.length > 0 ? (
          <View className="gap-3">
            <View className="gap-1">
              <Text variant="label">{t.weekSummary}</Text>
              <Text variant="title">{t.completeDays(completeDays)}</Text>
              {average ? <Text variant="caption">{t.averageDuration(average)}</Text> : null}
            </View>
            <StreakWeek days={week} />
          </View>
        ) : null}
      </HeroHeader>

      <View className="gap-6 px-5">
        <Banner tone="info" message={id.common.previewData} />
        <ChildSwitcher kids={kids} activeId={activeId} onChange={setActive} />

        {segment === 'brushing' ? (
          records.length === 0 ? (
            <EmptyState mascot="thinking" title={t.emptyBrushingTitle} message={t.emptyBrushingBody} />
          ) : (
            groupByMonth(records).map((group) => (
              <ListGroup key={group.title} title={group.title}>
                {group.items.map((r) => (
                  <ListRow
                    key={r.id}
                    icon={r.slot === 'evening' ? 'nightlight-round' : r.slot === 'morning' ? 'wb-sunny' : 'schedule'}
                    iconTone={r.slot === 'evening' ? 'blue' : r.slot === 'morning' ? 'sun' : 'lavender'}
                    title={slotLabel(r.slot)}
                    subtitle={`${formatDateTime(r.startedAt)} · ${r.synced ? t.synced : t.notSynced}`}
                    value={formatClock(r.durationS)}
                    onPress={() => router.push(`/history/${r.id}`)}
                  />
                ))}
              </ListGroup>
            ))
          )
        ) : segment === 'screening' ? (
          <EmptyState
            mascot="thinking"
            title={t.emptyScreeningTitle}
            message={t.emptyScreeningBody}
            action={{ label: t.emptyScreeningAction, onPress: () => router.navigate('/screening') }}
          />
        ) : (
          <EmptyState icon="description" title={t.emptyReferralTitle} message={t.emptyReferralBody} />
        )}
      </View>
    </Screen>
  );
}
