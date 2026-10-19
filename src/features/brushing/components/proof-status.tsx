import { ActivityIndicator, View } from 'react-native';

import { Banner } from '@/components/banner';
import { Icon, type IconName } from '@/components/icon';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { palette } from '@/core/theme';

import type { ProofAudience } from '../camera-availability';
import type { ProofOutcome } from '../finish-session';
import { proofSkipText, proofUploadText } from '../proof-copy';
import { isActiveUpload, useProofUpload, type ProofUpload } from '../proof-uploads';

const r = id.recording;

function ProgressBar({ progress, label }: { progress: number; label: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      className="h-2.5 overflow-hidden rounded-full bg-tint-lavender"
    >
      <View className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </View>
  );
}

function StatusRow({ icon, busy, text }: { icon: IconName; busy?: boolean; text: string }) {
  return (
    <View className="flex-row items-center gap-3" accessible accessibilityLiveRegion="polite" accessibilityLabel={text}>
      {busy ? <ActivityIndicator color={palette.primary} /> : <Icon name={icon} size={22} color={palette.primary} />}
      <Text variant="bodyStrong" className="flex-1">
        {text}
      </Text>
    </View>
  );
}

function UploadCard({ item, audience }: { item: ProofUpload | null; audience: ProofAudience }) {
  const text = proofUploadText(item, audience);
  if (item?.state === 'failed') return <Banner testID="proof-status" tone="warning" title={r.status.title} message={text} />;
  const active = !item || isActiveUpload(item);
  return (
    <View testID="proof-status" className="gap-2.5 rounded-tile bg-card p-4" style={{ borderCurve: 'continuous' }}>
      {item?.state === 'uploading' ? (
        <>
          <StatusRow icon="cloud-upload" text={text} />
          <ProgressBar progress={item.progress} label={r.status.uploadingLabel(Math.round(item.progress * 100))} />
        </>
      ) : item?.state === 'done' ? (
        <StatusRow icon="check-circle" text={text} />
      ) : item?.state === 'retrying' ? (
        <StatusRow icon="cloud-off" text={text} />
      ) : (
        <StatusRow icon="schedule" busy={!item} text={text} />
      )}
      {active ? (
        <Text variant="caption" tone="secondary">
          {r.status.background}
        </Text>
      ) : null}
    </View>
  );
}

function QueuedStatus({ proofId, audience }: { proofId: string; audience: ProofAudience }) {
  const item = useProofUpload(proofId);
  return <UploadCard item={item} audience={audience} />;
}

/**
 * This session's proof video on the done screen: being prepared, upload progress / waiting for
 * signal / sent, or why it was not sent. The brushing itself is recorded either way.
 */
export function ProofStatus({ outcome, preparing }: { outcome: ProofOutcome | null; preparing: boolean }) {
  if (!outcome) {
    return preparing ? (
      <View testID="proof-status" className="rounded-tile bg-card p-4" style={{ borderCurve: 'continuous' }}>
        <StatusRow icon="schedule" busy text={r.status.preparing} />
      </View>
    ) : null;
  }
  if (outcome.kind === 'queued') return <QueuedStatus proofId={outcome.proofId} audience={outcome.audience} />;
  if (outcome.kind === 'skipped') {
    return <Banner testID="proof-status" tone="warning" title={r.status.title} message={proofSkipText(outcome.reason)} />;
  }
  return null;
}
