import { Pressable, View } from 'react-native';

import { Card } from '@/components/card';
import { Icon, type IconName } from '@/components/icon';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { palette, useTheme } from '@/core/theme';
import { cn } from '@/lib/utils';

import type { Pain } from '../pipeline';

const t = id.screening.symptoms;
const rows = [
  [0, 1, 2, 3, 4, 5],
  [6, 7, 8, 9, 10],
];

// Original face icons from the app's icon font (no licensed pain-scale artwork).
function faceFor(score: number): IconName {
  if (score <= 1) return 'sentiment-very-satisfied';
  if (score <= 3) return 'sentiment-satisfied';
  if (score <= 5) return 'sentiment-neutral';
  if (score <= 7) return 'sentiment-dissatisfied';
  return 'sentiment-very-dissatisfied';
}

// 0–10 pain score (rules.json pain_scale) or "Tidak tahu", which the engine never reads as 0.
export function PainScale({ value, onChange }: { value: Pain | null; onChange: (pain: Pain) => void }) {
  const { touch } = useTheme();
  const selectedLabel = value === null ? null : value === 'unknown' ? t.painUnknown : t.painValue(value);

  return (
    <Card className="gap-4 p-5">
      <View className="gap-1">
        <Text variant="bodyStrong">{t.painTitle}</Text>
        <Text variant="caption" tone="secondary">
          {t.painHint}
        </Text>
      </View>

      <View className="flex-row items-center gap-3 rounded-tile bg-tint-lavender px-4 py-3" style={{ borderCurve: 'continuous' }}>
        <Icon
          name={typeof value === 'number' ? faceFor(value) : 'help-outline'}
          size={36}
          color={value === null ? palette.textSecondary : palette.primary}
        />
        <Text variant="headline" accessibilityLiveRegion="polite" tone={value === null ? 'secondary' : 'default'}>
          {selectedLabel ?? t.painHint}
        </Text>
      </View>

      <View accessibilityRole="radiogroup" accessibilityLabel={t.painTitle} className="gap-2">
        {rows.map((row) => (
          <View key={row[0]} className="flex-row gap-1.5">
            {row.map((score) => {
              const selected = value === score;
              return (
                <Pressable
                  key={score}
                  testID={`pain-${score}`}
                  accessibilityRole="radio"
                  accessibilityLabel={t.painValue(score)}
                  accessibilityState={{ checked: selected }}
                  onPress={() => onChange(score)}
                  className={cn(
                    'flex-1 items-center justify-center rounded-2xl border-2',
                    selected ? 'border-primary bg-primary' : 'border-separator bg-card',
                  )}
                  style={{ minHeight: touch.regular, borderCurve: 'continuous' }}
                >
                  <Text variant="headline" tone={selected ? 'onPrimary' : 'default'}>
                    {score}
                  </Text>
                </Pressable>
              );
            })}
            {/* Keeps the columns of both rows aligned. */}
            {row.length < rows[0].length ? <View className="flex-1" /> : null}
          </View>
        ))}
        <View className="flex-row justify-between px-1">
          <Text variant="caption" tone="secondary">
            {`0 = ${t.painNone}`}
          </Text>
          <Text variant="caption" tone="secondary">
            {`10 = ${t.painWorst}`}
          </Text>
        </View>
        <Pressable
          testID="pain-unknown"
          accessibilityRole="radio"
          accessibilityLabel={t.painUnknown}
          accessibilityState={{ checked: value === 'unknown' }}
          onPress={() => onChange('unknown')}
          className={cn(
            'items-center justify-center rounded-full border-2',
            value === 'unknown' ? 'border-primary bg-primary' : 'border-separator bg-card',
          )}
          style={{ minHeight: touch.regular }}
        >
          <Text variant="label" tone={value === 'unknown' ? 'onPrimary' : 'default'}>
            {t.painUnknown}
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}
