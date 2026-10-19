import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { HeroHeader } from '@/components/hero-header';
import { ListGroup, ListRow } from '@/components/list-group';
import { Screen } from '@/components/screen';
import { useAccountType } from '@/core/account/account-store';
import { useSession } from '@/core/auth/session-store';
import { id } from '@/core/i18n/id';
import { useLocalData } from '@/data/local-store';
import type { BrushingRecord, ScreeningRecord } from '@/domain/models';
import { ResultDetails } from '@/features/screening/components/result-details';
import { levelLook } from '@/features/screening/level-look';
import { formatClock, formatDateLong, formatTime } from '@/ui/format';

import { DetailShell } from './components/detail-shell';
import { ServerDetail } from './components/server-detail';
import { audienceFor, parseEntryKey, recallItem, type HistoryAudience } from './history-model';

const t = id.history;

function BrushingDetail({ record }: { record: BrushingRecord }) {
  const slot = record.slot === 'morning' ? t.slotMorning : record.slot === 'evening' ? t.slotEvening : t.slotOther;
  const icon = record.slot === 'evening' ? 'nightlight-round' : 'wb-sunny';

  return (
    <DetailShell
      testID="detail-local-brushing"
      icon={icon}
      label={slot}
      title={formatClock(record.durationS)}
      titleAccessibilityLabel={id.common.minutesSeconds(record.durationS)}
      caption={formatDateLong(record.startedAt)}
    >
      <ListGroup>
        <ListRow icon="event" title={t.detailDate} value={formatDateLong(record.startedAt)} />
        <ListRow icon="schedule" title={t.detailTime} value={formatTime(record.startedAt)} />
        <ListRow icon={icon} iconTone="sun" title={t.detailSlot} value={slot} />
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
    </DetailShell>
  );
}

// A saved screening: same result content as right after the flow (no photo, never stored).
function ScreeningDetail({ record }: { record: ScreeningRecord }) {
  return (
    <DetailShell
      testID="detail-local-screening"
      icon={levelLook[record.level].icon}
      label={t.segmentScreening}
      title={id.levels[record.level].label}
      caption={`${formatDateLong(record.screenedAt)} · ${formatTime(record.screenedAt)}`}
    >
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
    </DetailShell>
  );
}

function NotFound() {
  return (
    <Screen flush>
      <HeroHeader />
      <View className="px-5">
        <EmptyState mascot="thinking" title={id.timeline.detail.notFound} message={id.timeline.detail.notFoundBody} testID="detail-not-found" />
      </View>
    </Screen>
  );
}

// Detail of one history row. Route param: a local record id, or "kind:id" for a server item.
// Local records reuse their full views (a server item that also exists on this phone shows the
// richer local view); other server items come from the in-memory cache of the list.
export function HistoryDetailScreen() {
  const { id: param } = useLocalSearchParams<{ id: string }>();
  const accountType = useAccountType();
  const signedIn = useSession((s) => s.status === 'signedIn');
  const audience: HistoryAudience = signedIn ? audienceFor(accountType ?? 'guardian') : 'guest';

  const key = typeof param === 'string' ? parseEntryKey(param) : null;
  const localId = key?.id ?? (typeof param === 'string' ? param : '');
  const brushing = useLocalData((s) => s.brushing.find((r) => r.id === localId));
  const screening = useLocalData((s) => s.screenings.find((r) => r.id === localId));

  if (!key || key.kind === 'brushing') {
    if (brushing) return <BrushingDetail record={brushing} />;
  }
  if (!key || key.kind === 'screening') {
    if (screening) return <ScreeningDetail record={screening} />;
  }
  if (key) {
    const remembered = recallItem(key.kind, key.id);
    if (remembered) return <ServerDetail item={remembered.item} childId={remembered.childId} audience={audience} />;
  }
  return <NotFound />;
}
