import { Pressable, View } from 'react-native';

import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { palette, useTheme } from '@/core/theme';
import type { Answer } from '@/domain/triage';
import { cn } from '@/lib/utils';

const t = id.screening;
const order: Answer[] = ['yes', 'no', 'unknown'];

// One question, three answers. "Tidak tahu" is a real answer (never treated as "no").
export function QuestionCard({
  index,
  total,
  question,
  value,
  onChange,
  testID,
}: {
  index: number;
  total: number;
  question: string;
  value: Answer | undefined;
  onChange: (answer: Answer) => void;
  testID?: string;
}) {
  const { touch } = useTheme();
  return (
    <Card testID={testID} className="gap-4 p-5">
      <View className="flex-row gap-3">
        <View
          className={cn('size-8 items-center justify-center rounded-full', value ? 'bg-primary' : 'bg-tint-lavender')}
        >
          {value ? (
            <Icon name="check" size={18} color={palette.onPrimary} />
          ) : (
            <Text variant="label" tone="primary">
              {index}
            </Text>
          )}
        </View>
        <Text variant="bodyStrong" className="flex-1">
          {question}
        </Text>
      </View>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t.questionLabel(index, total, question)}
        className="flex-row gap-2"
      >
        {order.map((answer) => {
          const selected = value === answer;
          return (
            <Pressable
              key={answer}
              testID={testID ? `${testID}-${answer}` : undefined}
              accessibilityRole="radio"
              accessibilityLabel={t.answers[answer]}
              accessibilityState={{ checked: selected }}
              onPress={() => onChange(answer)}
              className={cn(
                'flex-1 items-center justify-center rounded-full border-2 px-2',
                selected ? 'border-primary bg-primary' : 'border-separator bg-card',
              )}
              style={{ minHeight: touch.regular }}
            >
              <Text variant="label" tone={selected ? 'onPrimary' : 'default'} className="text-center">
                {t.answers[answer]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}
