import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { LevelBadge } from '@/components/level-badge';
import { Screen } from '@/components/screen';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { useLocalData } from '@/data/local-store';
import { adviceText, triageRules, type Answer } from '@/domain/triage';
import { redFlagQuestions } from '@/features/screening/pipeline';
import { photoFromSession, referralFromRecord, type ReferralData } from '@/features/screening/referral-data';
import { ensureReferral } from '@/features/screening/referral-sync';
import { useScreeningSession } from '@/features/screening/session-store';
import { formatDateLong, formatTime } from '@/ui/format';

const t = id.screening.referral;
const answerLabel = id.screening.answers;

const photoLabel: Record<ReferralData['photo'], string> = {
  assessed: t.photoAssessed,
  not_assessed: t.photoNotAssessed,
  not_taken: t.photoNotTaken,
  quality_failed: t.photoQualityFailed,
};

function useReferralData(recordId: string | undefined): ReferralData | null {
  const kids = useLocalData((s) => s.kids);
  const record = useLocalData((s) => (recordId ? s.screenings.find((r) => r.id === recordId) : undefined));
  const session = useScreeningSession();
  if (recordId) {
    return record ? referralFromRecord(record, kids.find((k) => k.id === record.childId)?.nickname ?? null) : null;
  }
  if (session.outcome?.kind !== 'result') return null;
  return {
    screenedAt: session.record?.screenedAt ?? session.startedAt ?? new Date().toISOString(),
    childName: session.child?.nickname ?? null,
    ageMonths: session.ageMonths,
    level: session.outcome.output.level as ReferralData['level'],
    reasons: session.outcome.output.reasons,
    answers: session.answers,
    pain: session.pain,
    photo: photoFromSession(session.photoChoice, session.analysis?.detectorAvailable ?? false),
    rulesVersion: session.outcome.output.rules_version,
  };
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="gap-0.5 border-b border-separator py-2.5">
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}

// Referral letter to show on the phone at the puskesmas / dentist (offline). PDF export via
// expo-print comes later (app/CLAUDE.md §4). The nickname exists only on this device; the
// server only gets the referral metadata (level, reason codes), never the letter.
export default function Referral() {
  const { id: recordId } = useLocalSearchParams<{ id?: string }>();
  const data = useReferralData(recordId);
  // Opening the letter of a saved, non-routine screening records its referral once
  // (referral_created, queued behind the screening event by the sync bridge).
  const sessionRecordId = useScreeningSession((s) => s.record?.id ?? null);
  const screeningId = recordId ?? sessionRecordId;
  useEffect(() => {
    if (screeningId) ensureReferral(screeningId);
  }, [screeningId]);

  if (!data) {
    return (
      <Screen>
        <EmptyState icon="description" title={id.history.notFound} />
      </Screen>
    );
  }

  const flagged = redFlagQuestions.filter((q) => {
    const a = data.answers[q.id];
    return a === 'yes' || a === 'unknown';
  });
  const age =
    data.ageMonths === null ? t.ageUnknown : t.ageValue(Math.floor(data.ageMonths / 12), data.ageMonths % 12);
  const pain = data.pain === null ? '—' : data.pain === 'unknown' ? id.screening.symptoms.painUnknown : `${data.pain} / 10`;

  return (
    <Screen testID="screening-referral">
      <Card className="gap-4 p-6">
        <View className="gap-1">
          <Text variant="title" accessibilityRole="header">
            {t.heading}
          </Text>
          <Text variant="caption" tone="secondary">
            {t.to}
          </Text>
        </View>
        <Text variant="body">{t.intro}</Text>
        <LevelBadge level={data.level} />
        <View>
          <Row label={t.date} value={`${formatDateLong(data.screenedAt)} · ${formatTime(data.screenedAt)}`} />
          {data.childName ? <Row label={t.child} value={data.childName} /> : null}
          <Row label={t.age} value={age} />
          <Row label={t.level} value={triageRules.levels.find((l) => l.id === data.level)?.label ?? data.level} />
          <Row label={t.pain} value={pain} />
          <Row label={t.photo} value={photoLabel[data.photo]} />
        </View>

        <View className="gap-2">
          <Text variant="headline">{t.reasons}</Text>
          {data.reasons.map((r) => (
            <Text key={r.id} variant="body">
              {`• ${r.text}`}
            </Text>
          ))}
        </View>

        <View className="gap-2">
          <Text variant="headline">{t.redFlags}</Text>
          {flagged.length ? (
            flagged.map((q) => (
              <Text key={q.id} variant="body">
                {`• ${q.question} — ${answerLabel[data.answers[q.id] as Answer]}`}
              </Text>
            ))
          ) : (
            <Text variant="body">{t.none}</Text>
          )}
        </View>

        <View className="gap-1 border-t border-separator pt-3">
          <Text variant="bodyStrong">{adviceText('ADV_DISCLAIMER_NOT_DIAGNOSIS')}</Text>
          <Text variant="caption" tone="secondary">
            {t.rules(data.rulesVersion)}
          </Text>
        </View>
      </Card>
      <View className="gap-1 px-1">
        <Text variant="bodyStrong">{t.show}</Text>
        <Text variant="caption" tone="secondary">
          {t.pdfSoon}
        </Text>
      </View>
    </Screen>
  );
}
