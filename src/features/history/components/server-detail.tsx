import { router } from 'expo-router';
import { View } from 'react-native';

import { Card } from '@/components/card';
import { IconTile } from '@/components/icon-tile';
import { Icon } from '@/components/icon';
import { LevelBadge } from '@/components/level-badge';
import { ListGroup, ListRow } from '@/components/list-group';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { levelColors } from '@/core/theme';
import { fromServerLevel, type HistoryItem } from '@/domain/models';
import { adviceText } from '@/domain/triage';
import { levelLook } from '@/features/screening/level-look';
import { formatClock, formatDateLong, formatDateTime, formatTime } from '@/ui/format';

import type { HistoryAudience } from '../history-model';
import { daysUntil } from '../history-rows';
import { DetailShell } from './detail-shell';

const t = id.timeline;
const d = t.detail;
const REFERRAL_CTA = 'ADV_REFERRAL_CTA';

/** Local, immediate advice for a red flag: shown before anything else, never waits for the server. */
function RedFlagCard({ testID }: { testID?: string }) {
  const on = levelColors.emergency.on;
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      className="gap-2 rounded-card bg-level-emergency p-5"
      style={{ borderCurve: 'continuous' }}
    >
      <View className="flex-row items-center gap-3">
        <Icon name="warning" size={30} color={on} />
        <Text variant="title" style={{ color: on }} className="flex-1">
          {d.redFlagAdviceTitle}
        </Text>
      </View>
      <Text variant="bodyStrong" style={{ color: on }}>
        {d.redFlagAdviceBody}
      </Text>
    </View>
  );
}

/** Disclaimer + referral call to action: every result view carries both. */
function ResultFooter() {
  return (
    <>
      <Card tone="sky" className="gap-3">
        <View className="flex-row items-center gap-3">
          <IconTile name="description" tone="blue" size={44} />
          <Text variant="body" className="flex-1">
            {adviceText(REFERRAL_CTA) ?? d.referralBody}
          </Text>
        </View>
        <Text variant="caption" tone="secondary" testID="detail-local-hint">
          {d.localCopyHint}
        </Text>
      </Card>
      <View className="px-1">
        <Text variant="bodyStrong" testID="result-disclaimer">
          {id.common.disclaimer}
        </Text>
      </View>
    </>
  );
}

function dateRows(iso: string) {
  return [
    <ListRow key="date" icon="event" title={d.dateLabel} value={formatDateLong(iso)} />,
    <ListRow key="time" icon="schedule" title={d.timeLabel} value={formatTime(iso)} />,
  ];
}

/** A history item that has no local copy: shown from the in-memory list cache. */
export function ServerDetail({
  item,
  childId,
  audience,
}: {
  item: HistoryItem;
  childId: string;
  audience: HistoryAudience;
}) {
  const now = new Date();
  switch (item.kind) {
    case 'screening': {
      const x = item.data;
      const level = fromServerLevel(x.level);
      return (
        <DetailShell
          testID="detail-screening"
          icon={levelLook[level].icon}
          label={t.segments.screening}
          title={id.levels[level].label}
          caption={formatDateTime(item.occurredAt)}
        >
          {x.redFlag ? <RedFlagCard testID="detail-red-flag" /> : null}
          <LevelBadge level={level} />
          <ListGroup>
            {dateRows(item.occurredAt)}
            <ListRow icon={levelLook[level].icon} iconTone={levelLook[level].tone} title={d.levelLabel} value={id.levels[level].label} />
            <ListRow
              icon="warning"
              iconTone={x.redFlag ? 'danger' : 'mint'}
              title={d.redFlagLabel}
              value={x.redFlag ? d.redFlagYes : d.redFlagNo}
            />
            <ListRow icon="search" iconTone="blue" title={d.findingsLabel} value={String(x.findingsCount)} />
            <ListRow icon="rule" iconTone="lavender" title={d.rulesLabel} value={x.rulesVersion ?? d.notRecorded} />
            {x.requestId ? <ListRow icon="medical-services" iconTone="coral" title={d.answersRequest} /> : null}
          </ListGroup>
          <ResultFooter />
        </DetailShell>
      );
    }
    case 'referral': {
      const x = item.data;
      const level = fromServerLevel(x.level);
      return (
        <DetailShell
          testID="detail-referral"
          icon="description"
          tone="blue"
          label={t.row.referral.title}
          title={id.levels[level].label}
          caption={formatDateTime(item.occurredAt)}
        >
          <LevelBadge level={level} />
          <ListGroup>
            {dateRows(item.occurredAt)}
            <ListRow icon={levelLook[level].icon} iconTone={levelLook[level].tone} title={d.levelLabel} value={id.levels[level].label} />
            <ListRow icon="list" iconTone="lavender" title={d.referralReasons} value={String(x.reasonCodes.length)} />
            <ListRow icon="local-hospital" iconTone="coral" title={d.referralFacility} value={x.facilityCode ?? d.referralFacilityNone} />
          </ListGroup>
          <ResultFooter />
        </DetailShell>
      );
    }
    case 'screening_request': {
      const x = item.data;
      const open = x.status === 'pending' || x.status === 'seen';
      return (
        <DetailShell
          testID="detail-request"
          icon="medical-services"
          tone={x.reasonCode === 'swelling' ? 'danger' : 'coral'}
          label={d.requestLabel}
          title={t.reasons[x.reasonCode]}
          caption={formatDateTime(item.occurredAt)}
        >
          {x.reasonCode === 'swelling' ? <RedFlagCard testID="detail-red-flag" /> : null}
          <ListGroup>
            <ListRow icon="healing" iconTone="coral" title={d.requestReason} value={t.reasons[x.reasonCode]} />
            <ListRow
              icon="sentiment-dissatisfied"
              iconTone="sun"
              title={d.requestPain}
              value={x.painLevel === null ? d.requestPainNone : d.requestPainValue(x.painLevel)}
            />
            <ListRow icon="flag" iconTone="blue" title={d.requestStatus} value={t.requestStatus[x.status]} />
            <ListRow icon="send" iconTone="lavender" title={d.requestCreated} value={formatDateTime(item.occurredAt)} />
            <ListRow icon="visibility" iconTone="lavender" title={d.requestSeen} value={x.seenAt ? formatDateTime(x.seenAt) : d.requestNone} />
            <ListRow
              icon="done"
              iconTone="mint"
              title={d.requestResponded}
              value={x.respondedAt ? formatDateTime(x.respondedAt) : d.requestNone}
            />
            <ListRow icon="event" iconTone="lavender" title={d.requestExpires} value={formatDateTime(x.expiresAt)} />
          </ListGroup>
          {open && audience === 'guardian' ? (
            <Button testID="detail-open-requests" title={d.openRequests} icon="medical-services" onPress={() => router.push('/requests')} />
          ) : null}
          <View className="px-1">
            <Text variant="bodyStrong" testID="result-disclaimer">
              {id.common.disclaimer}
            </Text>
          </View>
        </DetailShell>
      );
    }
    case 'brushing_proof': {
      const x = item.data;
      const live = (x.status === 'uploaded' || x.status === 'viewed') && Date.parse(x.expiresAt) > now.getTime();
      const days = daysUntil(x.expiresAt, now);
      return (
        <DetailShell
          testID="detail-proof"
          icon="videocam"
          tone="mint"
          label={t.row.proof.title}
          title={t.proofStatus[x.status]}
          caption={formatDateTime(item.occurredAt)}
        >
          <ListGroup>
            {dateRows(item.occurredAt)}
            <ListRow icon="flag" iconTone="blue" title={d.proofStatus} value={t.proofStatus[x.status]} />
            <ListRow
              icon="timer"
              iconTone="mint"
              title={d.proofDuration}
              value={d.proofDurationValue(x.durationS)}
              accessibilityLabel={`${d.proofDuration}: ${d.proofDurationValue(x.durationS)}`}
            />
            {live ? <ListRow icon="auto-delete" iconTone="coral" title={d.proofExpires} value={d.expiresIn(days)} /> : null}
            {x.viewedAt ? <ListRow icon="visibility" iconTone="lavender" title={d.proofViewed} value={formatDateTime(x.viewedAt)} /> : null}
          </ListGroup>
          {live && audience !== 'child' ? (
            <Button
              testID="detail-watch"
              title={d.proofWatch}
              icon="play-arrow"
              accessibilityHint={d.proofWatchLabel}
              onPress={() => router.push({ pathname: '/proofs/[id]', params: { id: item.id, child: childId } })}
            />
          ) : (
            <Text variant="caption" tone="secondary" testID="detail-proof-gone">
              {d.proofGone}
            </Text>
          )}
        </DetailShell>
      );
    }
    case 'brushing': {
      const x = item.data;
      const slot = x.slot === 'morning' ? id.history.slotMorning : x.slot === 'evening' ? id.history.slotEvening : id.history.slotOther;
      return (
        <DetailShell
          testID="detail-brushing"
          icon={x.slot === 'evening' ? 'nightlight-round' : x.slot === 'morning' ? 'wb-sunny' : 'schedule'}
          label={slot}
          title={formatClock(x.durationS)}
          titleAccessibilityLabel={id.common.minutesSeconds(x.durationS)}
          caption={formatDateLong(item.occurredAt)}
        >
          <ListGroup>
            {dateRows(item.occurredAt)}
            <ListRow icon="wb-sunny" iconTone="sun" title={d.brushingSlot} value={slot} />
            <ListRow icon="timer" iconTone="blue" title={d.brushingDuration} value={id.common.minutesSeconds(x.durationS)} />
            <ListRow
              icon={x.cameraMode ? 'videocam' : 'music-note'}
              iconTone="coral"
              title={d.brushingMode}
              value={x.cameraMode ? d.brushingModeCamera : d.brushingModeTimer}
            />
            <ListRow
              icon="ondemand-video"
              iconTone="mint"
              title={d.brushingHasProof}
              value={x.hasProof ? d.brushingHasProofYes : d.brushingHasProofNo}
            />
            <ListRow
              icon="local-fire-department"
              iconTone="coral"
              title={d.brushingCounts}
              value={x.countsForStreak ? d.brushingCountsYes : d.brushingCountsNo}
            />
          </ListGroup>
        </DetailShell>
      );
    }
  }
}
