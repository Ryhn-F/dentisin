import { View } from 'react-native';

import { StreakCounter } from '@/components/streak';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import type { BrushingStreak } from '@/domain/models';
import { WeekDots } from '@/features/home/week-dots';
import { weekDots } from '@/features/home/streak';

const t = id.timeline;

// Streak block for the blue hero of the history screens: current run, longest run, whether
// today counts yet, and the last seven days. The numbers come from brushing_streak() merged
// with this phone's sessions (see useBrushingStreak); the child version uses simpler words.
export function StreakHeader({ streak, kid = false }: { streak: BrushingStreak; kid?: boolean }) {
  const labels = kid ? t.kid : t.streak;
  return (
    <View className="gap-4" testID="history-streak">
      <View className="flex-row items-center justify-between gap-3">
        <StreakCounter count={streak.current} />
        <View className="flex-1 items-end gap-1">
          {streak.longest > 0 ? (
            <Text variant="label" tone="onPrimary" testID="history-streak-longest">
              {labels.longest(streak.longest)}
            </Text>
          ) : null}
        </View>
      </View>
      <Text variant="caption" tone="onPrimary" testID="history-streak-today">
        {streak.todayDone ? labels.todayDone : kid ? t.kid.todayNotYet : t.streak.keepStreak}
      </Text>
      <WeekDots days={weekDots(streak)} doneLabel={labels.dayDone} notYetLabel={labels.dayNotYet} big={kid} />
    </View>
  );
}
