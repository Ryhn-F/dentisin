import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { BackHandler, View } from 'react-native';

import { Banner } from '@/components/banner';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { useTheme, type TriageLevel } from '@/core/theme';
import { adviceText } from '@/domain/triage';
import { FlowProgress, FLOW_STEPS } from '@/features/screening/components/flow-progress';
import { ResultDetails, type PhotoNote } from '@/features/screening/components/result-details';
import { useScreeningSession, type PhotoChoice } from '@/features/screening/session-store';

const t = id.screening.result;

function photoNoteFor(choice: PhotoChoice | null, detectorAvailable: boolean): PhotoNote | null {
  switch (choice) {
    case 'use':
      return detectorAvailable ? null : { tone: 'info', title: t.noDetectorTitle, message: t.noDetectorBody };
    case 'skip':
      return { tone: 'info', message: t.photoSkipped };
    case 'quality_failed':
      return { tone: 'warning', message: t.photoFailed };
    case 'red_flag':
      return { tone: 'info', message: t.redFlagNoPhoto };
    default:
      return null;
  }
}

// Step 4. Engine errors never show a level: the safe referral message replaces the result
// (backend fail-safe contract). Leaving (Selesai or hardware back) ends the session, which
// deletes the photo file; back never returns into the camera.
export default function Result() {
  const { mode } = useTheme();
  const outcome = useScreeningSession((s) => s.outcome);
  const capture = useScreeningSession((s) => s.capture);
  const analysis = useScreeningSession((s) => s.analysis);
  const photoChoice = useScreeningSession((s) => s.photoChoice);
  const saveState = useScreeningSession((s) => s.saveState);
  const leaving = useRef(false);

  const done = useCallback(() => {
    leaving.current = true;
    useScreeningSession.getState().reset();
    router.dismissTo('/screening');
  }, []);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        done();
        return true;
      });
      return () => sub.remove();
    }, [done]),
  );

  // Opened without a finished screening (e.g. after a reload): back to the start.
  useEffect(() => {
    if (!outcome && !leaving.current) router.replace('/screening');
  }, [outcome]);

  if (!outcome) return <View className="flex-1 bg-bg" />;

  if (outcome.kind === 'error') {
    return (
      <Screen testID="screening-result-error">
        <Banner tone="error" title={t.errorTitle} message={t.errorBody} />
        <Card className="gap-2">
          <Text variant="bodyStrong">{adviceText('ADV_DISCLAIMER_NOT_DIAGNOSIS')}</Text>
          <Text variant="caption" tone="secondary">
            {t.errorCode(outcome.code)}
          </Text>
        </Card>
        <Button testID="result-done" title={t.done} size="large" onPress={done} />
      </Screen>
    );
  }

  const { output } = outcome;
  const findings = analysis?.detections ?? [];
  const showPhoto = photoChoice === 'use' && capture && !(mode === 'child' && findings.length > 0);

  return (
    <Screen testID="screening-result">
      <FlowProgress step={FLOW_STEPS} />
      <ResultDetails
        level={output.level as TriageLevel}
        reasons={output.reasons}
        adviceIds={output.advice_ids}
        rulesVersion={output.rules_version}
        photo={showPhoto ? capture : null}
        findings={findings}
        photoNote={photoNoteFor(photoChoice, analysis?.detectorAvailable ?? false)}
        onReferral={() => router.push('/screening/referral')}
      />
      {saveState ? (
        <Banner
          testID={`save-state-${saveState}`}
          tone={saveState === 'saved' ? 'success' : 'info'}
          message={saveState === 'saved' ? t.saved : saveState === 'no_consent' ? t.notSavedNoConsent : t.notSavedNoChild}
        />
      ) : null}
      <Button testID="result-done" title={t.done} variant="secondary" size="large" onPress={done} />
    </Screen>
  );
}
