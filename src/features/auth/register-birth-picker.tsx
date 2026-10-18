import { useMemo } from 'react';
import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { Chip } from '@/components/chip';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';

import { birthYearChoices, type AgeBounds, type AgeGate } from './register-age';

const t = id.registerFlow;

// Birth year and month as tappable choices (no free text): shared by the register flow (before the
// form) and the teen setup screen. The month is optional ("Tidak ingat" = null); the age gate
// decides whether the year alone is enough.
export function BirthPicker({
  year,
  month,
  onYearChange,
  onMonthChange,
  now,
  testID = 'birth',
}: {
  year: number | null;
  month: number | null;
  onYearChange: (year: number) => void;
  onMonthChange: (month: number | null) => void;
  /** Injected in tests; defaults to the current date. */
  now?: Date;
  testID?: string;
}) {
  const years = useMemo(() => birthYearChoices(now), [now]);

  return (
    <View className="gap-5">
      <View className="gap-2" accessibilityRole="radiogroup" accessibilityLabel={t.birth.yearLabel}>
        <Text variant="label">{t.birth.yearLabel}</Text>
        <View className="flex-row flex-wrap gap-2">
          {years.map((y) => (
            <Chip
              key={y}
              testID={`${testID}-year-${y}`}
              label={String(y)}
              accessibilityLabel={t.birth.yearA11y(y)}
              selected={year === y}
              onPress={() => onYearChange(y)}
            />
          ))}
        </View>
      </View>

      <View className="gap-2" accessibilityRole="radiogroup" accessibilityLabel={t.birth.monthLabel}>
        <View className="gap-0.5">
          <Text variant="label">{t.birth.monthLabel}</Text>
          <Text variant="caption" tone="secondary">
            {t.birth.monthOptional}
          </Text>
        </View>
        <View className="flex-row flex-wrap gap-2">
          {id.months.map((label, i) => (
            <Chip
              key={label}
              testID={`${testID}-month-${i + 1}`}
              label={label}
              accessibilityLabel={t.birth.monthA11y(id.monthsLong[i])}
              selected={month === i + 1}
              onPress={() => onMonthChange(i + 1)}
            />
          ))}
          <Chip
            testID={`${testID}-month-none`}
            label={t.birth.monthUnknown}
            accessibilityLabel={t.birth.monthUnknownA11y}
            selected={month === null}
            onPress={() => onMonthChange(null)}
          />
        </View>
      </View>
    </View>
  );
}

// What the age gate says about the picked year (+ month). Nothing for an OK age.
// `action` is the parent-route button (register flow only); `extra` is one more line of text.
export function AgeGateNotice({
  gate,
  bounds,
  action,
  extra,
  testID = 'age-gate',
}: {
  gate: AgeGate;
  bounds: AgeBounds;
  action?: { label: string; onPress: () => void };
  extra?: string;
  testID?: string;
}) {
  const g = t.gate;
  if (gate.status === 'ok' || gate.status === 'invalid') return null;

  if (gate.status === 'needs_month') {
    return (
      <Banner
        testID={`${testID}-needs-month`}
        tone="info"
        title={g.needsMonthTitle}
        message={g.needsMonth(gate.range.lo, gate.range.hi)}
      />
    );
  }

  const tooYoung = gate.status === 'too_young';
  return (
    <Banner
      testID={`${testID}-${tooYoung ? 'too-young' : 'too-old'}`}
      tone="warning"
      title={tooYoung ? g.tooYoungTitle(bounds.min) : g.tooOldTitle(bounds.min, bounds.max)}
      message={[tooYoung ? g.tooYoung : g.tooOld, extra].filter(Boolean).join(' ')}
      action={
        action ? (
          <Button
            title={action.label}
            variant="secondary"
            size="regular"
            className="mt-2 self-start"
            testID={`${testID}-action`}
            onPress={action.onPress}
          />
        ) : undefined
      }
    />
  );
}
