import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { Card } from '@/components/card';
import { IconTile } from '@/components/icon-tile';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { useIsScreenFocused } from '@/core/theme';
import { FlowProgress } from '@/features/screening/components/flow-progress';
import { PhotoWithFindings } from '@/features/screening/components/photo-findings';
import { useScreeningSession } from '@/features/screening/session-store';
import type { QualityReason } from '@/ml/quality-gate';

const t = id.screening.review;
/** After this many failed photos, offer to continue without one (never force endless retakes). */
const OFFER_SKIP_AFTER = 2;

const reasonIcon: Record<QualityReason, 'flashlight-on' | 'wb-sunny' | 'pan-tool' | 'mood'> = {
  too_dark: 'flashlight-on',
  too_bright: 'wb-sunny',
  blurry: 'pan-tool',
  teeth_not_visible: 'mood',
};

// Step 3c: result of the on-device quality gate. A failed photo gets one concrete fix per
// reason and a friendly retake (app/CLAUDE.md §6.2: friendly retakes are a core feature).
export default function Review() {
  const capture = useScreeningSession((s) => s.capture);
  const quality = useScreeningSession((s) => s.quality);
  const attempts = useScreeningSession((s) => s.attempts);
  const discardCapture = useScreeningSession((s) => s.discardCapture);
  const finish = useScreeningSession((s) => s.finish);
  const [busy, setBusy] = useState<'use' | 'skip' | null>(null);
  const leaving = useRef(false);
  const focused = useIsScreenFocused();

  // Opened without a photo (e.g. after a reload): back to the guide. Only while focused (this
  // screen stays mounted under the result, whose "Selesai" clears the session), and not while
  // retaking, which clears the photo itself and returns to the camera.
  useEffect(() => {
    if (focused && (!capture || !quality) && !leaving.current) router.replace('/screening/guide');
  }, [focused, capture, quality]);

  if (!capture || !quality) return <View className="flex-1 bg-bg" />;
  const passed = quality.passed;

  async function go(choice: 'use' | 'quality_failed') {
    setBusy(choice === 'use' ? 'use' : 'skip');
    try {
      await finish(choice);
      router.push('/screening/result');
    } finally {
      setBusy(null);
    }
  }

  function retake() {
    leaving.current = true;
    discardCapture();
    router.back();
  }

  return (
    <Screen testID="screening-review">
      <FlowProgress step={3} />
      <PhotoWithFindings
        uri={capture.uri}
        width={capture.width}
        height={capture.height}
        accessibilityLabel={t.photoLabel}
      />

      <Card tone={passed ? 'mint' : 'peach'} className="gap-4" testID={passed ? 'quality-passed' : 'quality-failed'}>
        <View className="flex-row items-center gap-3" accessible accessibilityRole="alert" accessibilityLiveRegion="polite">
          <IconTile name={passed ? 'check' : 'refresh'} tone={passed ? 'white' : 'danger'} size={48} round />
          <View className="flex-1 gap-0.5">
            <Text variant="headline">{passed ? t.passTitle : t.failTitle}</Text>
            <Text variant="caption" tone="secondary">
              {passed ? t.passBody : t.failBody}
            </Text>
          </View>
        </View>
        {!passed
          ? quality.reasons.map((reason) => (
              <View
                key={reason}
                testID={`quality-reason-${reason}`}
                accessible
                accessibilityLabel={`${t.reasons[reason].title}. ${t.reasons[reason].fix}`}
                className="flex-row items-center gap-3 rounded-tile bg-card p-3"
                style={{ borderCurve: 'continuous' }}
              >
                <IconTile name={reasonIcon[reason]} tone="lavender" size={40} />
                <View className="flex-1">
                  <Text variant="bodyStrong">{t.reasons[reason].title}</Text>
                  <Text variant="caption" tone="secondary">
                    {t.reasons[reason].fix}
                  </Text>
                </View>
              </View>
            ))
          : null}
        <View className="gap-0.5">
          <Text variant="caption" tone="secondary">
            {t.attempt(attempts)}
          </Text>
          {quality.config_status === 'PLACEHOLDER' ? (
            <Text variant="caption" tone="secondary">
              {t.placeholderNote}
            </Text>
          ) : null}
        </View>
      </Card>

      <View className="gap-2">
        {passed ? (
          <>
            <Button
              testID="review-use"
              title={t.use}
              icon="check"
              variant="accent"
              size="large"
              loading={busy === 'use'}
              disabled={busy !== null}
              onPress={() => void go('use')}
            />
            <Button testID="review-retake" title={t.retake} icon="photo-camera" variant="ghost" disabled={busy !== null} onPress={retake} />
          </>
        ) : (
          <>
            <Button testID="review-retake" title={t.retake} icon="photo-camera" variant="accent" size="large" disabled={busy !== null} onPress={retake} />
            {attempts >= OFFER_SKIP_AFTER ? (
              <>
                <Button
                  testID="review-continue-without"
                  title={t.continueWithout}
                  variant="ghost"
                  loading={busy === 'skip'}
                  disabled={busy !== null}
                  onPress={() => void go('quality_failed')}
                />
                <Text variant="caption" tone="secondary" className="text-center">
                  {t.continueHint}
                </Text>
              </>
            ) : null}
          </>
        )}
      </View>
    </Screen>
  );
}
