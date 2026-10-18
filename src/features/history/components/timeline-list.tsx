import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListGroup, ListRow } from '@/components/list-group';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { palette } from '@/core/theme';
import { formatMonthYear } from '@/ui/format';

import { groupByMonth, type HistoryAudience, type MonthGroup, type TimelineEntry } from '../history-model';
import { describeEntry } from '../history-rows';

const t = id.timeline;
const HEADER_BAR = 56;
const SCRIM_AFTER = 12;

export type TimelineListProps = {
  entries: readonly TimelineEntry[];
  audience: HistoryAudience;
  /** Hero block, banners and filters above the first month. */
  header: ReactNode;
  /** Shown instead of the months when the list is empty. */
  empty: ReactElement;
  /** Rows are pressable only when this is given (child accounts have no detail screens). */
  onPressEntry?: (entry: TimelineEntry) => void;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  onLoadMore: () => void;
  refreshing: boolean;
  onRefresh: () => void;
  /** Fade a blue bar under the transparent navigation header while scrolling (hero screens). */
  heroScrim?: boolean;
  testID?: string;
};

// Virtualized timeline: one FlatList cell per calendar month (title + white rounded group),
// newest first, with keyset "load more" in the footer and on reaching the end.
export function TimelineList({
  entries,
  audience,
  header,
  empty,
  onPressEntry,
  hasMore,
  loadingMore,
  loadMoreFailed,
  onLoadMore,
  refreshing,
  onRefresh,
  heroScrim = false,
  testID,
}: TimelineListProps) {
  const insets = useSafeAreaInsets();
  const [scrolled, setScrolled] = useState(false);
  const groups = useMemo(() => groupByMonth(entries), [entries]);
  const kid = audience === 'child';
  const now = new Date();

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = e.nativeEvent.contentOffset.y > SCRIM_AFTER;
    if (next !== scrolled) setScrolled(next);
  }

  function renderGroup({ item }: { item: MonthGroup }) {
    return (
      <View className="px-5 pb-6">
        <ListGroup title={formatMonthYear(item.firstAt)}>
          {item.entries.map((entry) => {
            const look = describeEntry(entry, audience, now);
            return (
              <ListRow
                key={entry.key}
                testID={`history-row-${entry.key}`}
                icon={look.icon}
                iconTone={look.tone}
                title={look.title}
                subtitle={look.subtitle}
                value={look.value}
                onPress={onPressEntry ? () => onPressEntry(entry) : undefined}
              />
            );
          })}
        </ListGroup>
      </View>
    );
  }

  const footer = hasMore ? (
    <View className="items-center gap-3 px-5 pb-12 pt-2">
      {loadMoreFailed ? (
        <Text variant="caption" tone="danger" className="text-center">
          {t.loadMoreFailed}
        </Text>
      ) : null}
      {loadingMore ? (
        <View accessibilityRole="progressbar" accessibilityLabel={kid ? t.kid.loadingMore : t.loadingMore}>
          <ActivityIndicator color={palette.primary} />
        </View>
      ) : (
        <Button
          testID="history-load-more"
          variant="secondary"
          title={loadMoreFailed ? (kid ? t.kid.retry : t.retry) : kid ? t.kid.loadMore : t.loadMore}
          onPress={onLoadMore}
        />
      )}
    </View>
  ) : (
    <View className="pb-12" />
  );

  return (
    <View className="flex-1 bg-bg">
      <FlatList
        testID={testID}
        data={groups}
        keyExtractor={(g) => g.key}
        renderItem={renderGroup}
        ListHeaderComponent={<View>{header}</View>}
        ListEmptyComponent={<View className="px-5">{empty}</View>}
        ListFooterComponent={footer}
        onEndReached={() => {
          if (hasMore && !loadMoreFailed) onLoadMore();
        }}
        onEndReachedThreshold={0.4}
        onScroll={heroScrim ? onScroll : undefined}
        scrollEventThrottle={heroScrim ? 32 : undefined}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[palette.primary]} />}
        keyboardShouldPersistTaps="handled"
        className="flex-1 bg-bg"
        contentContainerStyle={{ flexGrow: 1 }}
      />
      {heroScrim && scrolled ? (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: insets.top + HEADER_BAR,
            backgroundColor: palette.primary,
          }}
        />
      ) : null}
    </View>
  );
}
