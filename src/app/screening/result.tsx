import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { BackHandler, View } from 'react-native';

import { Banner } from '@/components/banner';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { outbox } from '@/core/sync/outbox';
import { useTheme, type TriageLevel } from '@/core/theme';
import { adviceText } from '@/domain/triage';
import { FlowProgress, FLOW_STEPS } from '@/features/screening/components/flow-progress';
import { ResultDetails, type PhotoNote } from '@/features/screening/components/result-details';
import { useScreeningSession, type PhotoChoice } from '@/features/screening/session-store';
import { useScreeningSyncState, type ScreeningSyncState } from '@/features/screening/sync-state';

const t = id.screening.result;
const ts = id.screeningSync;

const syncLine: Record<ScreeningSyncState, string> = {
  guest: ts.status.guest,
  local_only: ts.status.localOnly,
  blocked: ts.status.blocked,
  synced: ts.status.synced,
  attention: ts.status.attention,
  pending: ts.status.pending,
};

// Saved on this phone, plus where it stands on its way to the account (outbox state of its
// screening_recorded event). Opened from a child's request: the request closes on the server
// once this screening is synced (ACCOUNTS_AND_FLOWS.md §2.5).
function SavedBanner({ recordId, requestId }: { recordId: string; requestId: string | null }) {
  const state = useScreeningSyncState(recordId);
  if (!state) return <Banner testID="save-state-saved" tone="success" message={t.saved} />;
  return (
    <Banner
      testID="save-state-saved"
      tone={state === 'attention' ? 'warning' : 'success'}
      title={ts.savedTitle}
      message={syncLine[state]}
      action={
        requestId && state !== 'guest' ? (
          <Text testID="save-state-request" variant="caption" tone="secondary">
            {ts.requestNote}
          </Text>
        ) : undefined
      }
    />
  );
}

type SentState = 'pending' | 'sent' | 'attention';

/** Outbox state of a screening_recorded event sent without a local copy. */
function useSentState(eventId: string): SentState {
  // Applied entries leave the queue (a small ledger remembers them); entity_conflict means the
  // screening is already on the server. Remember both for as long as this screen is open.
  const [sent, setSent] = useState(false);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(
    () =>
      outbox.subscribe((n) => {
        if (
          n.kind === 'entry' &&
          n.eventId.toLowerCase() === eventId.toLowerCase() &&
          (n.state === 'applied' || (n.state === 'rejected' && n.code === 'entity_conflict'))
        ) {
          setSent(true);
        }
        bump();
      }),
    [eventId],
  );
  const state = outbox.getEventState(eventId);
  if (sent || state === 'applied') return 'sent';
  if (state === 'rejected' || state === 'held') return 'attention';
  return 'pending';
}

// Consent (a) off, (b) on: not kept on this phone, but sent to the account (screening_recorded).
// Opened from a child's request: the request closes on the server once the event is applied.
function SentOnlyBanner({ eventId, requestId }: { eventId: string; requestId: string | null }) {
  const state = useSentState(eventId);
  return (
    <Banner
      testID="save-state-sent_only"
      tone={state === 'attention' ? 'warning' : 'info'}
      title={ts.sentOnly.title}
      message={state === 'sent' ? ts.sentOnly.sent : state === 'attention' ? ts.status.attention : ts.sentOnly.pending}
      action={
        requestId ? (
          <Text testID="save-state-request" variant="caption" tone="secondary">
            {ts.sentOnly.requestNote}
          </Text>
        ) : undefined
      }
    />
  );
}

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
  const record = useScreeningSession((s) => s.record);
  const sentEventId = useScreeningSession((s) => s.sentEventId);
  const requestId = useScreeningSession((s) => s.requestId);
  const triageSource = useScreeningSession((s) => s.triageSource);
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
        <Banner
          tone="error"
          title={outcome.code.startsWith('server_') ? ts.source.serverRejectedTitle : t.errorTitle}
          message={t.errorBody}
        />
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
      {triageSource ? (
        <Text testID={`triage-source-${triageSource}`} variant="caption" tone="secondary" className="px-1">
          {triageSource === 'server' ? ts.source.server : ts.source.device}
        </Text>
      ) : null}
      {saveState === 'saved' && record ? (
        <SavedBanner recordId={record.id} requestId={record.requestId} />
      ) : saveState === 'sent_only' && sentEventId ? (
        <SentOnlyBanner eventId={sentEventId} requestId={requestId} />
      ) : saveState === 'no_consent' || saveState === 'no_child' ? (
        <Banner
          testID={`save-state-${saveState}`}
          tone="info"
          message={saveState === 'no_consent' ? t.notSavedNoConsent : t.notSavedNoChild}
          action={
            // Neither kept nor sent: the child's request is not answered (ACCOUNTS_AND_FLOWS.md §2.5).
            saveState === 'no_consent' && requestId ? (
              <Text testID="save-state-request-open" variant="caption" tone="secondary">
                {ts.requestOpen}
              </Text>
            ) : undefined
          }
        />
      ) : null}
      <Button testID="result-done" title={t.done} variant="secondary" size="large" onPress={done} />
    </Screen>
  );
}
