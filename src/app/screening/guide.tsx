import { router } from 'expo-router';
import { useState } from 'react';
import { View, useWindowDimensions } from 'react-native';

import { Card } from '@/components/card';
import { Icon, type IconName } from '@/components/icon';
import { IconTile, type IconTileTone } from '@/components/icon-tile';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { palette } from '@/core/theme';
import { FlowProgress } from '@/features/screening/components/flow-progress';
import { MouthGuide } from '@/features/screening/components/mouth-guide';
import { useScreeningSession } from '@/features/screening/session-store';
import { useEnsureSession } from '@/features/screening/use-ensure-session';

const t = id.screening.guide;
const stepLook: { icon: IconName; tone: IconTileTone }[] = [
  { icon: 'wb-sunny', tone: 'sun' },
  { icon: 'flashlight-on', tone: 'blue' },
  { icon: 'mood', tone: 'coral' },
  { icon: 'straighten', tone: 'lavender' },
  { icon: 'pan-tool', tone: 'mint' },
];

// Step 3a: how to take a usable photo, before the camera opens. Only ~45% of parents' photos
// were diagnostic in the AICaries trial (app/CLAUDE.md §6.2), so the guide is part of the feature.
export default function PhotoGuide() {
  useEnsureSession();
  const { width } = useWindowDimensions();
  const finish = useScreeningSession((s) => s.finish);
  const [busy, setBusy] = useState(false);
  const illustration = Math.min(width - 40 - 40, 360);

  async function skip() {
    setBusy(true);
    try {
      await finish('skip');
      router.push('/screening/result');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen testID="screening-guide">
      <FlowProgress step={3} />
      <Card className="items-center gap-4 p-5">
        <MouthGuide width={illustration} accessibilityLabel={t.exampleLabel} />
        <Text variant="body" tone="secondary" className="text-center">
          {t.intro}
        </Text>
      </Card>

      <View className="gap-3">
        {t.steps.map((step, i) => (
          <View
            key={step.title}
            accessible
            accessibilityLabel={`${id.screening.stepLabel(i + 1, t.steps.length)}. ${step.title}. ${step.body}`}
            className="flex-row items-center gap-4 rounded-card bg-card p-4"
            style={{ borderCurve: 'continuous' }}
          >
            <View>
              <IconTile name={stepLook[i].icon} tone={stepLook[i].tone} size={52} />
              <View className="absolute -left-2 -top-2 size-7 items-center justify-center rounded-full border-2 border-card bg-ink">
                <Text variant="label" tone="onPrimary" style={{ fontSize: 13, lineHeight: 16 }}>
                  {i + 1}
                </Text>
              </View>
            </View>
            <View className="flex-1 gap-0.5">
              <Text variant="bodyStrong">{step.title}</Text>
              <Text variant="caption" tone="secondary">
                {step.body}
              </Text>
            </View>
          </View>
        ))}
      </View>

      <Card tone="cream" className="gap-3">
        <Text variant="headline" accessibilityRole="header">
          {t.tipsTitle}
        </Text>
        {t.tips.map((tip) => (
          <View key={tip} className="flex-row gap-3">
            <View className="pt-0.5">
              <Icon name="lightbulb-outline" size={20} color={palette.text} />
            </View>
            <Text variant="body" className="flex-1">
              {tip}
            </Text>
          </View>
        ))}
      </Card>

      <View className="flex-row items-center gap-3 px-1">
        <Icon name="lock" size={20} color={palette.success} />
        <Text variant="caption" tone="secondary" className="flex-1">
          {t.privacy}
        </Text>
      </View>

      <View className="gap-2">
        <Button
          testID="guide-open-camera"
          title={t.openCamera}
          icon="photo-camera"
          variant="accent"
          size="large"
          onPress={() => router.push('/screening/camera')}
        />
        <Button testID="guide-skip-photo" title={t.skipPhoto} variant="ghost" loading={busy} onPress={skip} />
        <Text variant="caption" tone="secondary" className="text-center">
          {t.skipHint}
        </Text>
      </View>
    </Screen>
  );
}
