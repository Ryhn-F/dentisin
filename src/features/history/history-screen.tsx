import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { useAccountType, useMe } from '@/core/account/account-store';
import { Banner } from '@/components/banner';
import { ChildSwitcher } from '@/components/child-switcher';
import { Chip } from '@/components/chip';
import { EmptyState } from '@/components/empty-state';
import { HeroHeader } from '@/components/hero-header';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useSession } from '@/core/auth/session-store';
import { flags } from '@/core/flags';
import { id } from '@/core/i18n/id';
import { childDisplayName, useLocalData } from '@/data/local-store';
import { useBrushingStreak } from '@/features/home/use-home-data';

import { StreakHeader } from './components/streak-header';
import { TimelineList } from './components/timeline-list';
import {
  audienceFor,
  kindsFor,
  localEntries,
  mergeTimeline,
  segmentsFor,
  setHistoryScope,
  type HistoryAudience,
  type HistorySegment,
  type TimelineEntry,
} from './history-model';
import { useChildHistory, type LocalOnlyReason } from './use-child-history';

const t = id.timeline;

/** A focus/foreground revalidation is skipped when the list was fetched this recently. */
const REVALIDATE_MS = 30_000;

const segmentLabel: Record<HistorySegment, string> = {
  all: t.segments.all,
  brushing: t.segments.brushing,
  screening: t.segments.screening,
  requests: t.segments.requests,
  video: t.segments.video,
};

function reasonMessage(reason: LocalOnlyReason): string {
  switch (reason) {
    case 'guest':
      return t.localOnly.guest;
    case 'not_deployed':
      return t.localOnly.notDeployed;
    case 'not_allowed':
      return t.localOnly.notAllowed;
    case 'auth_required':
      return t.localOnly.authRequired;
    case 'offline':
      return t.localOnly.offline;
  }
}

// History tab (guardian, teen, no-account mode): streak of the active child, a segmented list
// from child_history() (30 per page, keyset "load more") merged with this phone's unsynced
// records. Without the server (guest, backend without v2, offline) only local records show,
// with a small banner.
export function HistoryScreen() {
  const sessionStatus = useSession((s) => s.status);
  const userId = useSession((s) => s.userId);
  const me = useMe();
  const accountType = useAccountType();
  const kids = useLocalData((s) => s.kids);
  const activeId = useLocalData((s) => s.activeChildId);
  const setActive = useLocalData((s) => s.setActiveChild);
  const brushing = useLocalData((s) => s.brushing);
  const screenings = useLocalData((s) => s.screenings);

  const signedIn = sessionStatus === 'signedIn';
  const audience: HistoryAudience = signedIn ? audienceFor(accountType ?? 'guardian') : 'guest';
  const segments = segmentsFor(audience);
  const [chosen, setChosen] = useState<HistorySegment>('all');
  const segment = segments.includes(chosen) ? chosen : 'all';
  // Teen: the self profile. Everyone else: the active child.
  const childId = audience === 'teen' ? (me?.selfChildId ?? activeId) : activeId;
  const localReason: LocalOnlyReason | null = !signedIn ? 'guest' : me?.legacy ? 'not_deployed' : null;

  // Another user must never see the previous user's cached pages.
  setHistoryScope(signedIn ? userId : null);

  const history = useChildHistory({ childId, segment, audience, localReason });
  const { state } = history;
  const streak = useBrushingStreak(childId, localReason === null);
  const refreshStreak = streak.refresh;
  const revalidate = history.revalidate;

  useFocusEffect(
    useCallback(() => {
      void refreshStreak();
      void revalidate(REVALIDATE_MS);
    }, [refreshStreak, revalidate]),
  );

  // A local record the server accepted leaves the "unsynced" overlay: refetch so it shows up
  // in the server list at once instead of vanishing until the next refresh.
  const syncedCount = useMemo(
    () =>
      brushing.filter((r) => r.childId === childId && r.synced).length +
      screenings.filter((r) => r.childId === childId && r.synced).length,
    [brushing, screenings, childId],
  );
  const previousSynced = useRef(syncedCount);
  const refresh = history.refresh;
  useEffect(() => {
    if (previousSynced.current !== syncedCount) {
      previousSynced.current = syncedCount;
      void refresh();
    }
  }, [syncedCount, refresh]);

  const effectiveReason = localReason ?? state.localOnly;
  const kinds = kindsFor(audience, segment);

  const entries: TimelineEntry[] = useMemo(() => {
    const local = localEntries({ childId, brushing, screenings, kinds, onlyUnsynced: effectiveReason === null });
    return mergeTimeline(effectiveReason === null ? state.items : [], local);
    // `kinds` is derived from audience + segment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childId, brushing, screenings, audience, segment, effectiveReason, state.items]);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const switcherKids = useMemo(
    () =>
      kids.map((kid, i) => ({
        id: kid.id,
        nickname: childDisplayName(kid) ?? (kid.isSelf ? t.selfLabel : t.childFallback(i + 1)),
      })),
    [kids],
  );

  function open(entry: TimelineEntry) {
    // Local records open by their own id; server items by "kind:id" (read from the cache).
    router.push(`/history/${entry.origin === 'local' ? entry.id : entry.key}`);
  }

  const showStreak = !!childId;
  const header = (
    <>
      <HeroHeader>{showStreak ? <StreakHeader streak={streak.streak} /> : null}</HeroHeader>
      <View className="gap-4 px-5 pb-6 pt-6">
        {effectiveReason ? (
          <Banner
            testID="history-local-banner"
            tone="info"
            message={reasonMessage(effectiveReason)}
            action={
              effectiveReason === 'offline' ? (
                <Button testID="history-retry" variant="secondary" title={t.retry} onPress={() => void refresh()} />
              ) : undefined
            }
          />
        ) : null}
        {state.refreshFailed ? <Banner testID="history-refresh-failed" tone="warning" message={t.localOnly.refreshFailed} /> : null}
        {audience === 'guardian' || audience === 'guest' ? (
          <ChildSwitcher kids={switcherKids} activeId={activeId} onChange={setActive} />
        ) : null}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityLabel={t.segmentsLabel}
          contentContainerClassName="gap-2 py-1"
        >
          {segments.map((s) => (
            <Chip
              key={s}
              testID={`history-segment-${s}`}
              label={segmentLabel[s]}
              selected={s === segment}
              onPress={() => setChosen(s)}
            />
          ))}
        </ScrollView>
      </View>
    </>
  );

  const loading = state.loading && entries.length === 0;
  const empty = !childId ? (
    <EmptyState mascot="thinking" title={t.noChild.title} message={t.noChild.body} testID="history-no-child" />
  ) : loading ? (
    <View className="items-center gap-3 py-10" accessibilityRole="progressbar" accessibilityLabel={t.loading} testID="history-loading">
      <ActivityIndicator />
      <Text variant="caption" tone="secondary">
        {t.loading}
      </Text>
    </View>
  ) : segment === 'screening' ? (
    <EmptyState
      mascot="thinking"
      title={t.empty.screening.title}
      message={flags.medical_modules ? t.empty.screening.body : id.history.emptyScreeningBody}
      action={{
        label: flags.medical_modules ? id.history.emptyScreeningActionActive : id.history.emptyScreeningAction,
        onPress: () => router.navigate('/screening'),
      }}
      testID="history-empty"
    />
  ) : (
    <EmptyState mascot="thinking" title={t.empty[segment].title} message={t.empty[segment].body} testID="history-empty" />
  );

  return (
    <TimelineList
      testID="history-list"
      entries={entries}
      audience={audience}
      header={header}
      empty={empty}
      onPressEntry={open}
      hasMore={effectiveReason === null && state.nextBefore !== null}
      loadingMore={state.loadingMore}
      loadMoreFailed={state.loadMoreFailed}
      onLoadMore={() => void history.loadMore()}
      refreshing={refreshing}
      onRefresh={() => void onRefresh()}
      heroScrim
    />
  );
}
