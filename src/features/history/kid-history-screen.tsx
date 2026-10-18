import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Banner } from '@/components/banner';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Text } from '@/components/ui/text';
import { useMe } from '@/core/account/account-store';
import { useSession } from '@/core/auth/session-store';
import { id } from '@/core/i18n/id';
import { useLocalData } from '@/data/local-store';
import { useBrushingStreak } from '@/features/home/use-home-data';

import { StreakHeader } from './components/streak-header';
import { TimelineList } from './components/timeline-list';
import { hasOpenSwelling, kindsFor, localEntries, mergeTimeline, setHistoryScope, visibleEntries } from './history-model';
import { useChildHistory, type LocalOnlyReason } from './use-child-history';

const t = id.timeline.kid;
const REVALIDATE_MS = 30_000;

// History tab of a child account (/kid/history; ADR 017): the child's own brushing sessions,
// own screening requests and proof metadata, newest first, under the streak. Grade-4 words.
// Never screening results or referrals (a child account may not see them, so the server does
// not send them and this screen drops them even if one slipped in). Rows are not tappable.
export function KidHistoryScreen() {
  const me = useMe();
  const status = useSession((s) => s.status);
  const userId = useSession((s) => s.userId);
  const brushing = useLocalData((s) => s.brushing);

  const childId = me?.childAccount?.childId ?? null;
  const localReason: LocalOnlyReason | null =
    status !== 'signedIn' || !childId ? 'guest' : me?.legacy ? 'not_deployed' : null;

  setHistoryScope(status === 'signedIn' ? userId : null);

  const history = useChildHistory({ childId, segment: 'all', audience: 'child', localReason });
  const { state, refresh, revalidate } = history;
  const streak = useBrushingStreak(childId, localReason === null);
  const refreshStreak = streak.refresh;

  useFocusEffect(
    useCallback(() => {
      void refreshStreak();
      void revalidate(REVALIDATE_MS);
    }, [refreshStreak, revalidate]),
  );

  // Sessions the server accepted leave the "unsynced" overlay: refetch so they stay visible.
  const syncedCount = useMemo(() => brushing.filter((r) => r.childId === childId && r.synced).length, [brushing, childId]);
  const previousSynced = useRef(syncedCount);
  useEffect(() => {
    if (previousSynced.current !== syncedCount) {
      previousSynced.current = syncedCount;
      void refresh();
    }
  }, [syncedCount, refresh]);

  const remote = localReason === null && state.localOnly === null;
  const entries = useMemo(() => {
    const local = localEntries({
      childId,
      brushing,
      screenings: [],
      kinds: kindsFor('child', 'all'),
      onlyUnsynced: remote,
    });
    return visibleEntries(mergeTimeline(remote ? state.items : [], local), 'child');
  }, [childId, brushing, remote, state.items]);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const header = (
    <View className="gap-4 px-5 pb-6 pt-4">
      {hasOpenSwelling(entries) ? (
        <Banner testID="kid-history-swelling" tone="error" icon="local-hospital" title={t.swellingTitle} message={t.swellingBody} />
      ) : null}
      {!remote ? <Banner testID="kid-history-local" tone="info" message={t.localOnly} /> : null}
      {childId ? (
        <Card tone="blue" className="gap-3 p-5">
          <Text variant="label">{t.streakTitle}</Text>
          <StreakHeader streak={streak.streak} kid />
        </Card>
      ) : null}
      <Text variant="headline" accessibilityRole="header" className="px-1">
        {t.listTitle}
      </Text>
    </View>
  );

  const empty =
    state.loading && entries.length === 0 ? (
      <View className="items-center gap-3 py-10" accessibilityRole="progressbar" accessibilityLabel={t.loading} testID="kid-history-loading">
        <ActivityIndicator />
        <Text variant="caption" tone="secondary">
          {t.loading}
        </Text>
      </View>
    ) : (
      <EmptyState mascot="thinking" title={t.emptyTitle} message={t.empty} testID="kid-history-empty" />
    );

  return (
    <TimelineList
      testID="kid-history-list"
      entries={entries}
      audience="child"
      header={header}
      empty={empty}
      hasMore={remote && state.nextBefore !== null}
      loadingMore={state.loadingMore}
      loadMoreFailed={state.loadMoreFailed}
      onLoadMore={() => void history.loadMore()}
      refreshing={refreshing}
      onRefresh={() => void onRefresh()}
    />
  );
}
