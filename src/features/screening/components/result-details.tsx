import { Linking, View } from 'react-native';

import { Banner } from '@/components/banner';
import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { IconTile } from '@/components/icon-tile';
import { LevelBadge } from '@/components/level-badge';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { levelColors, palette, useTheme, type TriageLevel } from '@/core/theme';
import { adviceText, triageRules } from '@/domain/triage';


import { PhotoWithFindings, type Finding } from './photo-findings';

const t = id.screening.result;
const DISCLAIMER = 'ADV_DISCLAIMER_NOT_DIAGNOSIS';
const REFERRAL_CTA = 'ADV_REFERRAL_CTA';

export type PhotoNote = { tone: 'info' | 'warning'; title?: string; message: string };

function EmergencyCard({ adviceIds }: { adviceIds: readonly string[] }) {
  const { mode } = useTheme();
  const on = levelColors.emergency.on;
  // Advice that names the emergency numbers (rules.json `uses_contact`).
  const contactAdvice = triageRules.advice.find((a) => a.uses_contact && adviceIds.includes(a.id));
  const numbers = contactAdvice ? triageRules.contacts.emergency_numbers.value : [];
  return (
    <View
      testID="emergency-card"
      accessibilityRole="alert"
      className="gap-3 rounded-card bg-level-emergency p-5"
      style={{ borderCurve: 'continuous' }}
    >
      <View className="flex-row items-center gap-3">
        <Icon name="warning" size={34} color={on} />
        <Text variant="title" style={{ color: on }} className="flex-1">
          {t.emergencyTitle}
        </Text>
      </View>
      <Text variant="bodyStrong" style={{ color: on }}>
        {t.emergencyBody}
      </Text>
      {contactAdvice ? (
        <Text variant="body" style={{ color: on }}>
          {contactAdvice.text}
        </Text>
      ) : null}
      {/* Child mode has no outbound links: the child fetches an adult instead. */}
      {mode === 'child' ? (
        <Text variant="headline" style={{ color: on }}>
          {t.callAdult}
        </Text>
      ) : (
        numbers.map((n) => (
          <Button
            key={n}
            title={t.call(n)}
            icon="call"
            variant="inverse"
            accessibilityHint={t.callHint}
            onPress={() => Linking.openURL(`tel:${n}`).catch(() => {})}
          />
        ))
      )}
    </View>
  );
}

function BulletList({ items, icon }: { items: readonly string[]; icon: 'chevron-right' | 'check-circle' }) {
  return (
    <View className="gap-3">
      {items.map((text) => (
        <View key={text} className="flex-row gap-3">
          <View className="pt-0.5">
            <Icon name={icon} size={20} color={palette.primary} />
          </View>
          <Text variant="body" className="flex-1">
            {text}
          </Text>
        </View>
      ))}
    </View>
  );
}

// Everything a result screen must show (app/CLAUDE.md §3.2, backend "draft rules" contract):
// level as color + icon + word, reasons and advice from the rules file, the disclaimer, the
// referral CTA, and the DRAFT notice while rules are unapproved. Used by the live result and
// by a saved result in History.
export function ResultDetails({
  level,
  reasons,
  adviceIds,
  rulesVersion,
  photo,
  findings = [],
  photoNote,
  onReferral,
}: {
  level: TriageLevel;
  reasons: readonly { id: string; text: string }[];
  adviceIds: readonly string[];
  rulesVersion: string;
  photo?: { uri: string; width: number; height: number } | null;
  findings?: readonly Finding[];
  photoNote?: PhotoNote | null;
  onReferral: () => void;
}) {
  const emergency = level === 'emergency';
  const shownInCard = new Set(
    emergency ? triageRules.advice.filter((a) => a.uses_contact).map((a) => a.id) : [],
  );
  const advice = adviceIds
    .filter((a) => a !== DISCLAIMER && a !== REFERRAL_CTA && !shownInCard.has(a))
    .map(adviceText)
    .filter((text): text is string => !!text);

  // Group the fired rules by what they came from: red-flag answers, the photo, everything else.
  const stageOf = new Map(triageRules.rules.map((r) => [r.id, r.stage]));
  const redFlags = reasons.filter((r) => stageOf.get(r.id) === 'red_flag').map((r) => r.text);
  const photoReasons = reasons.filter((r) => stageOf.get(r.id)?.startsWith('detection')).map((r) => r.text);
  const other = reasons
    .filter((r) => { const st = stageOf.get(r.id); return st !== 'red_flag' && !st?.startsWith('detection'); })
    .map((r) => r.text);

  return (
    <View className="gap-6">
      {/* Red flag wins: the emergency card comes before everything else. */}
      {emergency ? <EmergencyCard adviceIds={adviceIds} /> : null}

      <Card className="gap-4" testID="result-red-flags">
        <Text variant="headline" accessibilityRole="header">
          {t.redFlagsTitle}
        </Text>
        {redFlags.length ? (
          <BulletList items={redFlags} icon="chevron-right" />
        ) : (
          <Text variant="body">{t.noRedFlags}</Text>
        )}
      </Card>

      <Card className="gap-4" testID="result-photo">
        <Text variant="headline" accessibilityRole="header">
          {t.photoTitle}
        </Text>
        {photo ? (
          <PhotoWithFindings
            uri={photo.uri}
            width={photo.width}
            height={photo.height}
            findings={findings}
            accessibilityLabel={findings.length ? t.photoWithFindings(findings.length) : id.screening.review.photoLabel}
          />
        ) : null}
        {findings.map((f, i) => (
          <View key={`${f.class}-${i}`} className="flex-row items-center gap-3">
            <View className="size-7 items-center justify-center rounded-full bg-sun">
              <Text variant="label" tone="onAccent">
                {i + 1}
              </Text>
            </View>
            <View className="flex-1">
              <Text variant="bodyStrong">{t.findings[f.class]}</Text>
              <Text variant="caption" tone="secondary">
                {t.findingCheck}
              </Text>
            </View>
          </View>
        ))}
        {photoReasons.length ? <BulletList items={photoReasons} icon="chevron-right" /> : null}
        {photoNote ? (
          <Banner tone={photoNote.tone} title={photoNote.title} message={photoNote.message} />
        ) : !findings.length && !photoReasons.length ? (
          <Text variant="body">{photo ? t.noPhotoFindings : t.photoNotAssessed}</Text>
        ) : null}
      </Card>

      {other.length ? (
        <Card className="gap-4">
          <Text variant="headline" accessibilityRole="header">
            {t.otherTitle}
          </Text>
          <BulletList items={other} icon="chevron-right" />
        </Card>
      ) : null}

      <View className="gap-3">
        <Text variant="headline" accessibilityRole="header">
          {t.levelTitle}
        </Text>
        <LevelBadge level={level} />
      </View>

      {advice.length ? (
        <Card className="gap-4">
          <Text variant="headline" accessibilityRole="header">
            {t.adviceTitle}
          </Text>
          <BulletList items={advice} icon="check-circle" />
        </Card>
      ) : null}

      <Card tone="sky" className="gap-4">
        <View className="flex-row items-center gap-3">
          <IconTile name="description" tone="blue" size={44} />
          <Text variant="body" className="flex-1">
            {adviceText(REFERRAL_CTA)}
          </Text>
        </View>
        <Button testID="referral-button" title={t.referralAction} icon="description" onPress={onReferral} />
      </Card>

      <View className="gap-1 px-1">
        <Text variant="bodyStrong" testID="result-disclaimer">
          {adviceText(DISCLAIMER)}
        </Text>
        <Text variant="caption" tone="secondary">
          {t.rulesVersion(rulesVersion)}
        </Text>
      </View>
    </View>
  );
}
