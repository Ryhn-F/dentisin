import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { useMe } from '@/core/account/account-store';
import { Banner } from '@/components/banner';
import { Card } from '@/components/card';
import { Icon, type IconName } from '@/components/icon';
import { IconTile, type IconTileTone } from '@/components/icon-tile';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { palette, useTheme } from '@/core/theme';
import { cn } from '@/lib/utils';
import { requestReasons, type RequestReason } from '@/domain/models';
import { PainScale } from '@/features/screening/components/pain-scale';
import type { Pain } from '@/features/screening/pipeline';

import {
  needsLocalAdvice,
  isRedFlagReason,
  painToLevel,
  redFlagIcons,
  reasonLook,
  sendRequest,
  visibleRedFlags,
  type RedFlagAnswers,
  type RedFlagId,
  type RequestOutcome,
} from './request-flow';

const t = id.requests.kidFlow;

type Step = 'reason' | 'pain' | 'flags' | 'result';
const STEPS = 3;

const statusLook: Record<RequestOutcome, { icon: IconName; tone: IconTileTone }> = {
  sending: { icon: 'hourglass-top', tone: 'lavender' },
  sent: { icon: 'check', tone: 'mint' },
  queued: { icon: 'schedule', tone: 'sun' },
  limit: { icon: 'info-outline', tone: 'sun' },
  consent: { icon: 'info-outline', tone: 'sun' },
  syncOff: { icon: 'info-outline', tone: 'sun' },
  failed: { icon: 'info-outline', tone: 'sun' },
};

function StepBar({ step }: { step: number }) {
  return (
    <View
      accessible
      accessibilityLabel={t.stepOf(step, STEPS)}
      className="flex-row items-center gap-3"
      testID="request-step-bar"
    >
      <View className="flex-1 flex-row gap-1.5">
        {Array.from({ length: STEPS }, (_, i) => (
          <View key={i} className={cn('h-2 flex-1 rounded-full', i < step ? 'bg-primary' : 'bg-separator')} />
        ))}
      </View>
      <Text variant="label" tone="secondary">
        {t.stepOf(step, STEPS)}
      </Text>
    </View>
  );
}

// Step 1: one big picture button per reason code (codes only, no free text).
function ReasonStep({ value, onPick }: { value: RequestReason | null; onPick: (reason: RequestReason) => void }) {
  const { touch } = useTheme();
  return (
    <View className="gap-4">
      <View className="gap-1">
        <Text variant="display" accessibilityRole="header">
          {t.reasonTitle}
        </Text>
        <Text variant="body" tone="secondary">
          {t.reasonHint}
        </Text>
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel={t.reasonTitle} className="flex-row flex-wrap gap-3">
        {requestReasons.map((reason) => {
          const look = reasonLook[reason];
          const selected = value === reason;
          return (
            <PressableScale
              key={reason}
              testID={`reason-${reason}`}
              accessibilityRole="radio"
              accessibilityLabel={t.reasonLabel(t.reasons[reason])}
              accessibilityState={{ checked: selected }}
              onPress={() => onPick(reason)}
              containerClassName="w-[48%] grow"
              className={cn(
                'items-center justify-center gap-3 rounded-card border-2 px-3 py-5',
                selected ? 'border-primary bg-tint-lavender' : 'border-separator bg-card',
              )}
              minHeight={Math.max(touch.large, 132)}
            >
              <IconTile name={look.icon} tone={look.tone} size={64} round />
              <Text variant="headline" className="text-center">
                {t.reasons[reason]}
              </Text>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

// Step 3: yes/no picture questions. Answers decide the local advice only; they are not sent.
function FlagQuestion({
  flag,
  value,
  onChange,
}: {
  flag: RedFlagId;
  value: boolean | undefined;
  onChange: (value: boolean) => void;
}) {
  const { touch } = useTheme();
  const question = t.flags[flag];
  return (
    <Card className="gap-4 p-5" testID={`flag-${flag}`}>
      <View className="flex-row items-center gap-4">
        <IconTile name={redFlagIcons[flag]} tone="lavender" size={56} round />
        <Text variant="headline" className="flex-1">
          {question}
        </Text>
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel={question} className="flex-row gap-3">
        {([true, false] as const).map((answer) => {
          const selected = value === answer;
          return (
            <PressableScale
              key={String(answer)}
              testID={`flag-${flag}-${answer ? 'yes' : 'no'}`}
              accessibilityRole="radio"
              accessibilityLabel={`${question} ${answer ? t.yes : t.no}`}
              accessibilityState={{ checked: selected }}
              onPress={() => onChange(answer)}
              containerClassName="flex-1"
              className={cn(
                'items-center justify-center rounded-full border-2',
                selected ? 'border-primary bg-primary' : 'border-separator bg-card',
              )}
              minHeight={touch.large}
            >
              <Text variant="headline" tone={selected ? 'onPrimary' : 'default'}>
                {answer ? t.yes : t.no}
              </Text>
            </PressableScale>
          );
        })}
      </View>
    </Card>
  );
}

// Local red-flag advice. Shown first, offline, without waiting for the server (CLAUDE.md §2.4).
function RedFlagAdvice() {
  return (
    <Card tone="coral" className="items-center gap-4 p-7" testID="request-red-flag-advice">
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <IconTile name="priority-high" tone="white" size={72} round />
      </View>
      <View accessible accessibilityRole="alert" accessibilityLiveRegion="assertive" className="gap-2">
        <Text variant="display" className="text-center">
          {t.advice.title}
        </Text>
        <Text variant="headline" className="text-center">
          {t.advice.body}
        </Text>
      </View>
    </Card>
  );
}

function StatusCard({ outcome }: { outcome: RequestOutcome }) {
  const look = statusLook[outcome];
  return (
    <Card tone={outcome === 'sent' ? 'mint' : 'white'} className="flex-row items-center gap-4 p-5" testID="request-status">
      <IconTile name={look.icon} tone={outcome === 'sent' ? 'white' : look.tone} size={52} round />
      <Text variant="headline" className="flex-1" accessibilityLiveRegion="polite" testID={`request-status-${outcome}`}>
        {t.status[outcome]}
      </Text>
    </Card>
  );
}

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/kid');
}

// Child account: "Gigiku sakit" in three steps, then the request goes to the parent through the
// outbox (screening_requested). The server only gets reason_code + pain_level; the red-flag
// answers stay on the phone and only decide the advice shown here.
export function NewRequestScreen() {
  const childId = useMe()?.childAccount?.childId ?? null;
  const [step, setStep] = useState<Step>('reason');
  const [reason, setReason] = useState<RequestReason | null>(null);
  const [pain, setPain] = useState<Pain | null>(null);
  const [answers, setAnswers] = useState<RedFlagAnswers>({});
  const [outcome, setOutcome] = useState<RequestOutcome>('sending');
  const [redFlag, setRedFlag] = useState(false);
  const cancelSend = useRef<(() => void) | null>(null);

  // Stops listening for the status when the child leaves; a queued request still goes out.
  useEffect(() => () => cancelSend.current?.(), []);

  const questions = visibleRedFlags(reason);
  const allAnswered = questions.every((flag) => answers[flag] !== undefined);

  function send() {
    if (!reason) return;
    // Red flags and severe pain both show the local advice first (never waits for the server).
    const flagged = needsLocalAdvice(reason, answers, pain);
    setRedFlag(flagged);
    setStep('result');
    setOutcome('sending');
    cancelSend.current?.();
    if (!childId) {
      setOutcome('failed');
      return;
    }
    cancelSend.current = sendRequest({ childId, reason, painLevel: painToLevel(pain) }, setOutcome);
  }

  if (step === 'result') {
    return (
      <Screen testID="new-request-result">
        {redFlag ? <RedFlagAdvice /> : null}
        <StatusCard outcome={outcome} />
        <Button title={t.done} testID="request-done" variant="accent" size="large" icon="check" onPress={leave} />
      </Screen>
    );
  }

  return (
    <Screen testID={`new-request-${step}`}>
      <StepBar step={step === 'reason' ? 1 : step === 'pain' ? 2 : 3} />

      {step === 'reason' ? (
        <ReasonStep
          value={reason}
          onPick={(picked) => {
            if (picked !== reason) setAnswers({});
            setReason(picked);
            setStep('pain');
          }}
        />
      ) : null}

      {step !== 'reason' && isRedFlagReason(reason) ? (
        <Banner tone="error" icon="priority-high" message={t.swellingNotice} testID="request-swelling-notice" />
      ) : null}

      {step === 'pain' ? (
        <View className="gap-4">
          <Text variant="body" tone="secondary">
            {t.painIntro}
          </Text>
          <PainScale value={pain} onChange={setPain} />
          <Button
            testID="request-next"
            title={t.next}
            iconRight="arrow-forward"
            size="large"
            disabled={pain === null}
            onPress={() => setStep('flags')}
          />
          <Button title={t.back} variant="ghost" icon="arrow-back" onPress={() => setStep('reason')} />
        </View>
      ) : null}

      {step === 'flags' ? (
        <View className="gap-4">
          <View className="gap-1">
            <Text variant="display" accessibilityRole="header">
              {t.flagsTitle}
            </Text>
            <Text variant="body" tone="secondary">
              {t.flagsIntro}
            </Text>
          </View>
          {questions.map((flag) => (
            <FlagQuestion
              key={flag}
              flag={flag}
              value={answers[flag]}
              onChange={(value) => setAnswers((prev) => ({ ...prev, [flag]: value }))}
            />
          ))}
          <View className="flex-row items-center gap-2 px-1">
            <Icon name="lock-outline" size={18} color={palette.textSecondary} />
            <Text variant="caption" tone="secondary" className="flex-1">
              {t.privacyNote}
            </Text>
          </View>
          <Button
            testID="request-send"
            title={t.send}
            icon="send"
            variant="accent"
            size="large"
            disabled={!allAnswered}
            accessibilityHint={t.sendHint}
            onPress={send}
          />
          <Button title={t.back} variant="ghost" icon="arrow-back" onPress={() => setStep('pain')} />
        </View>
      ) : null}
    </Screen>
  );
}
