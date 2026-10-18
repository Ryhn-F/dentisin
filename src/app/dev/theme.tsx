// Developer gallery of the design system (linked from About only in __DEV__ builds).
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { ConsentCard } from '@/components/consent-card';
import { Blob, Ring, Sparkle } from '@/components/decor';
import { FeatureTile } from '@/components/feature-tile';
import { LevelBadge } from '@/components/level-badge';
import { ListGroup, ListRow } from '@/components/list-group';
import { Mascot } from '@/components/mascot';
import { PasswordField } from '@/components/password-field';
import { ProgressRing } from '@/components/progress-ring';
import { Screen } from '@/components/screen';
import { SegmentedControl } from '@/components/segmented-control';
import { StreakCounter, StreakLegend, StreakWeek, type StreakDay } from '@/components/streak';
import { SyncStatusPill } from '@/components/sync-status-pill';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { checkPassword } from '@/core/auth/validation';
import { id } from '@/core/i18n/id';
import { palette, tintNames, triageLevels, useUiMode, type TypeVariant } from '@/core/theme';

const t = id.preview;
const typeVariants: TypeVariant[] = ['hero', 'display', 'title', 'headline', 'label', 'body', 'bodyStrong', 'caption'];
const swatches: [string, string][] = [
  ['bg', palette.bg],
  ['surface', palette.surface],
  ['card', palette.card],
  ['text', palette.text],
  ['textSecondary', palette.textSecondary],
  ['primary', palette.primary],
  ['primaryDeep', palette.primaryDeep],
  ['accent', palette.accent],
  ['coral', palette.coral],
  ['success', palette.success],
  ['danger', palette.danger],
  ['outline', palette.outline],
  ...tintNames.map((n): [string, string] => [`tint.${n}`, palette.tints[n]]),
];
const sampleWeek: StreakDay[] = [0, 1, 2, 3, 4, 5, 6].map((i) => ({
  date: `2026-10-0${i + 5}`,
  weekday: i,
  morning: i < 4,
  evening: i < 3,
  isToday: i === 3,
  isFuture: i > 3,
}));

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-3">
      <Text variant="title">{title}</Text>
      {children}
    </View>
  );
}

export default function ThemeGallery() {
  const { mode, setMode } = useUiMode();
  const [segment, setSegment] = useState<'a' | 'b' | 'c'>('a');
  const [password, setPassword] = useState('Gigi2026');
  const [on, setOn] = useState(true);
  const [checked, setChecked] = useState(false);

  return (
    <Screen>
      <SegmentedControl
        options={[
          { value: 'adult', label: t.modeAdult },
          { value: 'child', label: t.modeChild },
        ]}
        value={mode}
        onChange={setMode}
      />

      <Section title={t.sectionColors}>
        <View className="flex-row flex-wrap gap-3">
          {swatches.map(([name, color]) => (
            <View key={name} className="grow basis-[28%] gap-1">
              <View className="h-12 rounded-2xl border border-separator" style={{ backgroundColor: color }} />
              <Text variant="caption" tone="secondary">
                {name}
              </Text>
            </View>
          ))}
        </View>
      </Section>

      <Section title={t.sectionType}>
        {typeVariants.map((variant) => (
          <View key={variant} className="gap-1">
            <Text variant="caption" tone="secondary">
              {variant}
            </Text>
            <Text variant={variant}>{variant === 'hero' ? '1:45' : t.typeSample}</Text>
          </View>
        ))}
      </Section>

      <Section title={t.sectionButtons}>
        <Button title={t.buttonPrimary} variant="accent" size="large" icon="play-arrow" />
        <Button title={t.buttonPrimary} size="large" />
        <Button title={t.buttonSecondary} variant="secondary" />
        <Button title={t.buttonGhost} variant="ghost" />
        <Button title={t.buttonLoading} loading />
        <Button title={t.buttonDisabled} disabled />
        <Button title={t.buttonDanger} variant="danger" />
      </Section>

      <Section title={t.sectionComponents}>
        <Card tone="blue" className="gap-4">
          <Blob color={palette.coral} size={140} style={{ right: -50, top: -50 }} />
          <Ring color={palette.accent} size={44} thickness={8} style={{ right: 100, top: 16 }} />
          <View className="flex-row items-center justify-between">
            <StreakCounter count={12} />
            <Mascot size={90} withBrush />
          </View>
          <StreakWeek days={sampleWeek} />
          <StreakLegend />
          <Button title={id.home.startBrushing} variant="accent" icon="play-arrow" />
        </Card>
        <View className="flex-row gap-3">
          <FeatureTile compact style={{ flex: 1 }} icon="timer" tone="blue" title={id.features.brushing.title} onPress={() => {}} />
          <FeatureTile compact style={{ flex: 1 }} icon="opacity" tone="sun" title={id.features.toothpaste.title} onPress={() => {}} />
        </View>
        <View className="flex-row gap-3">
          <FeatureTile compact style={{ flex: 1 }} icon="menu-book" tone="coral" title={id.features.education.title} onPress={() => {}} />
          <FeatureTile compact style={{ flex: 1 }} icon="photo-camera" tone="lavender" title={id.features.screening.title} status="soon" statusLabel={id.common.soon} />
        </View>
        <View className="flex-row flex-wrap items-end justify-around gap-2 rounded-card bg-tint-lavender p-4">
          <Mascot size={80} mood="happy" />
          <Mascot size={80} mood="wow" />
          <Mascot size={80} mood="thinking" />
          <Mascot size={80} mood="sleepy" />
          <Sparkle color={palette.accent} size={24} style={{ right: 12, top: 8 }} />
        </View>
        <SegmentedControl
          options={[
            { value: 'a', label: id.history.segmentBrushing },
            { value: 'b', label: id.history.segmentScreening },
            { value: 'c', label: id.history.segmentReferral },
          ]}
          value={segment}
          onChange={setSegment}
        />
        <View className="flex-row flex-wrap items-center gap-2">
          <Chip label="Adik" icon="face" selected onPress={() => {}} />
          <Chip label="Kakak" icon="face" onPress={() => {}} />
          <Switch checked={on} onCheckedChange={setOn} accessibilityLabel="Switch" />
          <Checkbox checked={checked} onCheckedChange={setChecked} accessibilityLabel="Checkbox" />
        </View>
        <View className="flex-row flex-wrap gap-2">
          <SyncStatusPill status="synced" />
          <SyncStatusPill status="pending" />
          <SyncStatusPill status="local" />
        </View>
        <ListGroup title={id.profile.moreTitle} footer={id.profile.kidsFooter}>
          <ListRow icon="settings" title={id.profile.settings} onPress={() => {}} />
          <ListRow icon="timer" iconTone="blue" title={id.home.lastBrushing} subtitle="Sen, 5 Okt · 06.45" value="2:05" />
          <ListRow icon="delete-forever" title={id.settings.deleteAccount} destructive onPress={() => {}} />
        </ListGroup>
        <TextField label={id.auth.email} placeholder={id.auth.emailPlaceholder} />
        <TextField label={id.auth.email} value="nama@" error={id.auth.fieldErrors.emailInvalid} />
        <PasswordField label={id.auth.password} value={password} onChangeText={setPassword} rules={checkPassword(password)} />
        <Banner tone="info" message={id.syncV2.messages.localOnly} />
        <Banner tone="warning" message={id.toothpaste.reviewBanner} />
        <Banner tone="error" message={id.auth.errors.invalidCredentials} />
        <Banner tone="success" message={id.auth.checkEmail.resent} />
        <View className="items-center rounded-card bg-primary py-6">
          <ProgressRing progress={0.6} size={200} trackColor={palette.primaryDeep} color={palette.accent} accessibilityLabel={id.brushing.ringLabel(48)}>
            <Text variant="hero" tone="onPrimary">
              0:48
            </Text>
          </ProgressRing>
        </View>
      </Section>

      <Section title={t.sectionLevels}>
        {triageLevels.map((level) => (
          <LevelBadge key={level} level={level} />
        ))}
        <Text variant="body" tone="secondary">
          {id.common.disclaimer}
        </Text>
      </Section>

      <Section title={t.sectionConsent}>
        <ConsentCard copy={id.consent.storeLocal} value={checked} onValueChange={setChecked} />
      </Section>
    </Screen>
  );
}
