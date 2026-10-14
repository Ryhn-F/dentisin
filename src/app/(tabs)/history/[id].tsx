import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { HeroHeader } from '@/components/hero-header';
import { IconTile } from '@/components/icon-tile';
import { ListGroup, ListRow } from '@/components/list-group';
import { Screen } from '@/components/screen';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import type { BrushingRecord, ScreeningRecord } from '@/domain/models';
import { levelLook } from '@/features/screening/level-look';
import { ResultDetails } from '@/features/screening/components/result-details';
import { useMockData } from '@/mock/store';
import { formatClock, formatDateLong, formatTime } from '@/ui/format';

const t = id.history;

function BrushingDetail({ record }: { record: BrushingRecord }) {
  const slot = record.slot === 'morning' ? t.slotMorning : record.slot === 'evening' ? t.slotEvening : t.slotOther;

  return (
    <Screen flush>
      <HeroHeader>
        <View className="flex-row items-center gap-4">
          <IconTile name={record.slot === 'evening' ? 'nightlight-round' : 'wb-sunny'} tone="sun" size={64} />
          <View className="flex-1">
            <Text variant="label">{slot}</Text>
            <Text variant="hero" accessibilityLabel={id.common.minutesSeconds(record.durationS)}>
              {formatClock(record.durationS)}
            </Text>
            <Text variant="caption">{formatDateLong(record.startedAt)}</Text>
          </View>
        </View>
      </HeroHeader>
      <View className="px-5">
        <ListGroup>
          <ListRow icon="event" title={t.detailDate} value={formatDateLong(record.startedAt)} />
          <ListRow icon="schedule" title={t.detailTime} value={formatTime(record.startedAt)} />
          <ListRow
            icon={record.slot === 'evening' ? 'nightlight-round' : 'wb-sunny'}
            iconTone="sun"
            title={t.detailSlot}
            value={slot}
          />
          <ListRow icon="timer" iconTone="blue" title={t.detailDuration} value={id.common.minutesSeconds(record.durationS)} />
          <ListRow
            icon={record.cameraMode ? 'videocam' : 'music-note'}
            iconTone="coral"
            title={t.detailMode}
            value={record.cameraMode ? t.detailModeCamera : t.detailModeTimer}
          />
          <ListRow
            icon={record.synced ? 'cloud-done' : 'cloud-upload'}
            iconTone="mint"
            title={t.detailSync}
            value={record.synced ? t.synced : t.notSynced}
          />
        </ListGroup>
      </View>
    </Screen>
  );
}

// A saved screening: same result content as right after the flow (no photo — never stored).
function ScreeningDetail({ record }: { record: ScreeningRecord }) {
  return (
    <Screen flush>
      <HeroHeader>
        <View className="flex-row items-center gap-4">
          <IconTile name={levelLook[record.level].icon} tone="sun" size={64} />
          <View className="flex-1">
            <Text variant="label">{t.segmentScreening}</Text>
            <Text variant="title">{id.levels[record.level].label}</Text>
            <Text variant="caption">{`${formatDateLong(record.screenedAt)} · ${formatTime(record.screenedAt)}`}</Text>
          </View>
        </View>
      </HeroHeader>
      <View className="gap-6 px-5">
        <ResultDetails
          level={record.level}
          reasons={record.reasons}
          adviceIds={record.adviceIds}
          rulesVersion={record.rulesVersion}
          onReferral={() => router.push({ pathname: '/screening/referral', params: { id: record.id } })}
        />
        <ListGroup>
          <ListRow
            icon={record.synced ? 'cloud-done' : 'cloud-upload'}
            iconTone="mint"
            title={t.detailSync}
            value={record.synced ? t.synced : t.notSynced}
          />
        </ListGroup>
      </View>
    </Screen>
  );
}

export default function HistoryDetail() {
  const { id: recordId } = useLocalSearchParams<{ id: string }>();
  const brushing = useMockData((s) => s.brushing.find((r) => r.id === recordId));
  const screening = useMockData((s) => s.screenings.find((r) => r.id === recordId));

  if (brushing) return <BrushingDetail record={brushing} />;
  if (screening) return <ScreeningDetail record={screening} />;
  return (
    <Screen flush>
      <HeroHeader />
      <View className="px-5">
        <EmptyState mascot="thinking" title={t.notFound} />
      </View>
    </Screen>
  );
}
