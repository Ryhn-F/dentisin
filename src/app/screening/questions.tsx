import { router } from 'expo-router';
import { View } from 'react-native';

import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';

import { FlowProgress } from '@/features/screening/components/flow-progress';
import { QuestionCard } from '@/features/screening/components/question-card';
import { redFlagQuestions } from '@/features/screening/pipeline';
import { useScreeningSession } from '@/features/screening/session-store';
import { useEnsureSession } from '@/features/screening/use-ensure-session';

const t = id.screening;

// Step 1: red-flag questions (rules.json, group "red_flag"), always before any photo.
// A red flag no longer ends the flow (ADR 021): every step still runs and the result shows it.
export default function RedFlagQuestions() {
  useEnsureSession();
  const answers = useScreeningSession((s) => s.answers);
  const setAnswer = useScreeningSession((s) => s.setAnswer);
  const missing = redFlagQuestions.filter((q) => answers[q.id] === undefined).length;

  return (
    <Screen testID="screening-questions">
      <FlowProgress step={1} />
      <Text variant="body">{t.redFlags.intro}</Text>

      <View className="gap-4">
        {redFlagQuestions.map((q, i) => (
          <QuestionCard
            key={q.id}
            testID={`q-${q.id}`}
            index={i + 1}
            total={redFlagQuestions.length}
            question={q.question}
            value={answers[q.id]}
            onChange={(answer) => setAnswer(q.id, answer)}
          />
        ))}
      </View>
      <View className="gap-2">
        {missing ? (
          <Text variant="caption" tone="secondary" className="text-center" accessibilityLiveRegion="polite">
            {t.unanswered(missing)}
          </Text>
        ) : null}
        <Button
          testID="questions-next"
          title={t.next}
          iconRight="arrow-forward"
          size="large"
          disabled={missing > 0}
          onPress={() => router.push('/screening/symptoms')}
        />
      </View>
    </Screen>
  );
}
