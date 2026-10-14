import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { FlowProgress } from '@/features/screening/components/flow-progress';
import { PainScale } from '@/features/screening/components/pain-scale';
import { QuestionCard } from '@/features/screening/components/question-card';
import { isEmergencyAlready, symptomQuestions } from '@/features/screening/pipeline';
import { useScreeningSession } from '@/features/screening/session-store';
import { useEnsureSession } from '@/features/screening/use-ensure-session';

const t = id.screening;

// Step 2: the remaining symptom questions and the 0–10 pain score. Answers that already reach
// the emergency level (e.g. night pain, with today's cautious params) also skip the photo.
export default function Symptoms() {
  useEnsureSession();
  const answers = useScreeningSession((s) => s.answers);
  const pain = useScreeningSession((s) => s.pain);
  const setAnswer = useScreeningSession((s) => s.setAnswer);
  const setPain = useScreeningSession((s) => s.setPain);
  const finish = useScreeningSession((s) => s.finish);
  const [busy, setBusy] = useState(false);
  const missing = symptomQuestions.filter((q) => answers[q.id] === undefined).length + (pain === null ? 1 : 0);

  async function next() {
    if (!isEmergencyAlready(answers, pain)) {
      router.push('/screening/guide');
      return;
    }
    setBusy(true);
    try {
      await finish('red_flag');
      router.push('/screening/result');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen testID="screening-symptoms">
      <FlowProgress step={2} />
      <Text variant="body">{t.symptoms.intro}</Text>
      <View className="gap-4">
        {symptomQuestions.map((q, i) => (
          <QuestionCard
            key={q.id}
            testID={`q-${q.id}`}
            index={i + 1}
            total={symptomQuestions.length}
            question={q.question}
            value={answers[q.id]}
            onChange={(answer) => setAnswer(q.id, answer)}
          />
        ))}
        <PainScale value={pain} onChange={setPain} />
      </View>
      <View className="gap-2">
        {missing ? (
          <Text variant="caption" tone="secondary" className="text-center" accessibilityLiveRegion="polite">
            {t.unanswered(missing)}
          </Text>
        ) : null}
        <Button
          testID="symptoms-next"
          title={t.next}
          iconRight="arrow-forward"
          size="large"
          disabled={missing > 0}
          loading={busy}
          onPress={next}
        />
      </View>
    </Screen>
  );
}
