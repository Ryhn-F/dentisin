import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner } from '@/components/banner';
import { Card } from '@/components/card';
import { ChildSwitcher } from '@/components/child-switcher';
import { Blob } from '@/components/decor';
import { EmptyState } from '@/components/empty-state';
import { FeatureTile } from '@/components/feature-tile';
import { Icon } from '@/components/icon';
import { ListGroup, ListRow } from '@/components/list-group';
import { Mascot } from '@/components/mascot';
import { ScreeningCard } from '@/components/screening-card';
import { Screen } from '@/components/screen';
import { SectionHeader } from '@/components/section-header';
import { StreakCounter } from '@/components/streak';
import { SyncStatusPill } from '@/components/sync-status-pill';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useMe } from '@/core/account/account-store';
import { useSession } from '@/core/auth/session-store';
import { flags } from '@/core/flags';
import { id } from '@/core/i18n/id';
import { useSyncStatus } from '@/core/sync/use-sync-status';
import { palette, useIsScreenFocused } from '@/core/theme';
import { useLocalData } from '@/data/local-store';
import { brushingWindows } from '@/domain/brushing-windows';
import { currentWeek } from '@/domain/streak';
import { bannerKey, deriveHomeBanners, homeChildren, unviewedProofsOf, type HomeBanner } from '@/features/home/banners';
import { weekDots } from '@/features/home/streak';
import { useForegroundPoll } from '@/features/home/use-foreground-poll';
import { latestBrushing, mergeBrushing } from '@/features/home/today-brushing';
import { useBrushingStreak, useServerChildren, useTodayBrushing } from '@/features/home/use-home-data';
import { WeekDots } from '@/features/home/week-dots';
import { formatClock, formatDateTime } from '@/ui/format';

const t = id.home;
const v2 = id.homeV2;

function greeting(now: Date) {
  const h = now.getHours();
  if (h < 11) return t.greetingMorning;
  if (h < 18) return t.greetingDay;
  return t.greetingEvening;
}

function SlotStatus({
  label,
  icon,
  done,
  window,
}: {
  label: string;
  icon: 'wb-sunny' | 'nightlight-round';
  done: boolean;
  window: string;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${done ? t.slotDone : window}`}
      // Icon beside the label, status on its own line: the time window ("19.00–23.00")
      // gets the full card width and never wraps on 360dp phones.
      className="flex-1 gap-1 rounded-2xl bg-primary-deep p-3"
    >
      <View className="flex-row items-center gap-1.5">
        <Icon name={icon} size={20} color={palette.accent} />
        <Text variant="label">{label}</Text>
      </View>
      <View className="flex-row items-center gap-1">
        {done ? <Icon name="check-circle" size={16} color={palette.accent} /> : null}
        <Text variant="caption">{done ? t.slotDone : window}</Text>
      </View>
    </View>
  );
}

function CountBadge({ count }: { count: number }) {
  return (
    <View className="rounded-full bg-coral px-3 py-1">
      <Text variant="label" style={{ color: palette.onCoral }}>
        {v2.guardian.newCount(count)}
      </Text>
    </View>
  );
}

function HomeBannerView({ banner }: { banner: HomeBanner }) {
  const b = v2.banners;
  switch (banner.kind) {
    case 'requests':
      return (
        <Banner
          testID="home-banner-requests"
          tone="warning"
          icon="notifications-active"
          title={b.requestsTitle}
          message={b.requestsBody(banner.names)}
          action={<Button title={b.requestsAction} variant="ghost" className="self-start" onPress={() => router.push('/requests')} />}
        />
      );
    case 'proofs':
      return (
        <Banner
          testID={`home-banner-proofs-${banner.childId}`}
          tone="info"
          icon="videocam"
          title={b.proofsTitle}
          message={b.proofsBody(banner.count, banner.name)}
          action={
            <Button
              title={b.proofsAction}
              variant="ghost"
              className="self-start"
              onPress={() => router.push({ pathname: '/proofs', params: { child: banner.childId } })}
            />
          }
        />
      );
    case 'deletion':
      return (
        <Banner
          testID="home-banner-deletion"
          tone="info"
          title={b.deletionTitle}
          message={banner.self ? b.deletionBodySelf : b.deletionBody(banner.names)}
        />
      );
    case 'unnamed':
      return (
        <Banner
          testID="home-banner-unnamed"
          tone="info"
          icon="edit"
          title={b.unnamedTitle}
          message={b.unnamedBody(banner.count)}
          action={<Button title={b.unnamedAction} variant="ghost" className="self-start" onPress={() => router.navigate('/profile')} />}
        />
      );
  }
}

// Home of guardian, teen and guest (ADR 017/018). Guest: local only, as before. Guardian:
// children from this phone plus list_children() (merged; badges for requests and proof
// videos), polled while the screen is shown (ACCOUNTS_AND_FLOWS.md §2.5). Teen: the app is
// for the teen's own teeth: no child switcher, no add-child, "Video sikat gigiku".
export default function Home() {
  const focused = useIsScreenFocused();
  const insets = useSafeAreaInsets();
  const sync = useSyncStatus();
  const status = useSession((s) => s.status);
  const me = useMe();
  const kids = useLocalData((s) => s.kids);
  const activeId = useLocalData((s) => s.activeChildId);
  const setActive = useLocalData((s) => s.setActiveChild);
  const allBrushing = useLocalData((s) => s.brushing);

  const signedIn = status === 'signedIn' && me !== null;
  const teen = signedIn && me.accountType === 'teen';
  // A legacy backend (my_account missing) has none of the v2 RPCs: stay local.
  const v2Backend = signedIn && !me.legacy && me.accountType !== 'child';

  const children = useMemo(() => homeChildren(kids), [kids]);
  const selfId = teen ? (me.selfChildId ?? kids.find((k) => k.isSelf)?.id ?? null) : null;
  const kidId = teen ? selfId : (kids.find((k) => k.id === activeId) ?? kids[0] ?? null)?.id ?? null;
  const kidLabel = children.find((c) => c.id === kidId)?.label ?? null;

  // Brushing is recorded for the active child: keep it pointing at the shown one.
  useEffect(() => {
    if (kidId && kidId !== activeId && kids.some((k) => k.id === kidId)) setActive(kidId);
  }, [kidId, activeId, kids, setActive]);

  const server = useServerChildren();
  const remote = v2Backend && !server.stopped;
  const streak = useBrushingStreak(kidId, remote);
  const todayBrushing = useTodayBrushing(kidId, remote);
  useForegroundPoll(() => Promise.all([server.refresh(), streak.refresh(), todayBrushing.refresh()]), {
    enabled: remote,
    // A new active child fetches its streak and sessions now, not at the next tick.
    restartKey: kidId,
  });

  const banners = signedIn ? deriveHomeBanners({ accountType: me.accountType, rows: server.rows, children }) : [];
  const teenUnviewed = unviewedProofsOf(server.rows, selfId);
  const showTeenProofs = teen && !me.legacy && (me.flags.brushingProofVideo || teenUnviewed > 0);
  // Guardian: permanent entry points (the banners above only show while something is new).
  const guardian = signedIn && me.accountType === 'guardian';
  const withAccounts = server.rows.some((r) => r.hasChildAccount);
  const unseenRequests = server.rows.reduce((n, r) => n + r.unseenRequests, 0);
  const unviewedProofs = server.rows.reduce((n, r) => n + r.unviewedProofs, 0);
  const showRequests = guardian && remote && (withAccounts || server.rows.some((r) => r.openRequests > 0));
  const showProofs = guardian && remote && ((me.flags.brushingProofVideo && withAccounts) || unviewedProofs > 0);

  // Slot cards and the last-brushing row use this phone's records plus today's sessions the
  // server has (e.g. brushed on the child's own phone). Local first: they may be unsynced.
  const localRecords = useMemo(() => allBrushing.filter((r) => r.childId === kidId), [allBrushing, kidId]);
  const records = useMemo(() => mergeBrushing(localRecords, todayBrushing.records), [localRecords, todayBrushing.records]);
  const today = currentWeek(records).find((d) => d.isToday);
  const last = latestBrushing(records);
  // A session only the server has opens its cached server item ("kind:id" route param).
  const lastHref = last ? (localRecords.some((r) => r.id === last.id) ? `/history/${last.id}` as const : `/history/brushing:${last.id}` as const) : null;
  const w = brushingWindows;
  const switcherKids = children.map((c) => ({ id: c.id, nickname: c.label }));

  let subtitle: string;
  if (teen) subtitle = v2.teen.subtitle;
  else subtitle = kidLabel ? t.subtitle(kidLabel) : t.subtitleNoChild;

  return (
    <Screen className="pt-0" topScrim={{ color: 'bg', height: 'statusBar' }}>
      {/* Greeting block (no navigation bar on the home tab, like the reference). */}
      <View className="gap-3" style={{ paddingTop: insets.top + 12 }}>
        <View className="flex-row items-center justify-between gap-3">
          <Text variant="body" tone="secondary" className="shrink">
            {greeting(new Date())}
          </Text>
          <SyncStatusPill status={sync} />
        </View>
        <Text variant="display" accessibilityRole="header">
          {subtitle}
        </Text>
        {teen ? null : <ChildSwitcher kids={switcherKids} activeId={kidId} onChange={setActive} />}
      </View>

      {banners.length ? (
        <View className="gap-3">
          {banners.map((b) => (
            <HomeBannerView key={bannerKey(b)} banner={b} />
          ))}
        </View>
      ) : null}

      {/* The main feature first (it is also the center tab). Teens screen themselves. */}
      <ScreeningCard
        testID="home-screening"
        soon={!flags.medical_modules}
        activeBody={teen ? id.homeV2.teen.screeningCardBody : undefined}
        onPress={() => router.navigate('/screening')}
      />

      {kidId ? (
        <Card tone="blue" className="gap-5 p-6" testID="streak-card">
          <Blob color={palette.coral} size={150} variant={0} style={{ right: -50, top: -50 }} />
          <Blob color={palette.primaryDeep} size={200} variant={2} opacity={0.7} style={{ left: -90, bottom: -120 }} />
          <View className="flex-row items-center justify-between">
            <View className="gap-2">
              <Text variant="label">{t.streakTitle}</Text>
              <StreakCounter count={streak.streak.current} active={focused} />
            </View>
            <Mascot size={104} withBrush />
          </View>
          <Text variant="caption" testID="streak-hint">
            {streak.streak.todayDone ? t.streakHint : v2.keepStreak}
          </Text>
          <WeekDots days={weekDots(streak.streak)} doneLabel={v2.dayDone} notYetLabel={v2.dayNotYet} />
          <View className="flex-row gap-2">
            <SlotStatus label={t.todayMorning} icon="wb-sunny" done={!!today?.morning} window={t.slotWindow(w.morning.start, w.morning.end)} />
            <SlotStatus label={t.todayEvening} icon="nightlight-round" done={!!today?.evening} window={t.slotWindow(w.evening.start, w.evening.end)} />
          </View>
          <Button
            title={t.startBrushing}
            icon="play-arrow"
            variant="accent"
            size="large"
            testID="home-start-brushing"
            onPress={() => router.push('/brushing/session')}
          />
        </Card>
      ) : teen ? null : (
        <EmptyState
          mascot="thinking"
          title={t.emptyTitle}
          message={t.emptyBody}
          action={{ label: t.emptyAction, onPress: () => router.push('/profile/child/new') }}
        />
      )}

      {showTeenProofs && selfId ? (
        <ListGroup>
          <ListRow
            testID="home-teen-proofs"
            icon="videocam"
            iconTone="coral"
            title={v2.teen.proofsTitle}
            subtitle={v2.teen.proofsSubtitle}
            accessibilityLabel={v2.teen.proofsLabel(teenUnviewed)}
            onPress={() => router.push({ pathname: '/proofs', params: { child: selfId } })}
            accessory={
              teenUnviewed > 0 ? (
                <View className="rounded-full bg-coral px-3 py-1" testID="home-teen-proofs-badge">
                  <Text variant="label" style={{ color: palette.onCoral }}>
                    {v2.teen.proofsNew(teenUnviewed)}
                  </Text>
                </View>
              ) : undefined
            }
          />
        </ListGroup>
      ) : null}

      {showRequests || showProofs ? (
        <ListGroup>
          {showRequests ? (
            <ListRow
              testID="home-guardian-requests"
              icon="medical-services"
              iconTone="sun"
              title={v2.guardian.requestsTitle}
              subtitle={v2.guardian.requestsSubtitle}
              accessibilityLabel={v2.guardian.requestsLabel(unseenRequests)}
              onPress={() => router.push('/requests')}
              accessory={unseenRequests > 0 ? <CountBadge count={unseenRequests} /> : undefined}
            />
          ) : null}
          {showProofs ? (
            <ListRow
              testID="home-guardian-proofs"
              icon="videocam"
              iconTone="coral"
              title={v2.guardian.proofsTitle}
              subtitle={v2.guardian.proofsSubtitle}
              accessibilityLabel={v2.guardian.proofsLabel(unviewedProofs)}
              onPress={() => router.push('/proofs')}
              accessory={unviewedProofs > 0 ? <CountBadge count={unviewedProofs} /> : undefined}
            />
          ) : null}
        </ListGroup>
      ) : null}

      <View className="gap-3">
        <SectionHeader title={t.featuresTitle} action={{ label: t.seeAll, onPress: () => router.navigate('/features') }} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-5" contentContainerClassName="gap-3 px-5">
          {/* Same color per feature everywhere (Fitur tab, Home). */}
          <FeatureTile compact style={{ width: 170 }} icon="timer" tone="sun" title={id.features.brushing.title} onPress={() => router.push('/brushing/session')} />
          <FeatureTile compact style={{ width: 170 }} icon="opacity" tone="lavender" title={id.features.toothpaste.title} onPress={() => router.push('/feature/toothpaste')} />
          <FeatureTile compact style={{ width: 170 }} icon="menu-book" tone="coral" title={id.features.education.title} onPress={() => router.push('/feature/education')} />
        </ScrollView>
      </View>

      <Card tone="cream" className="flex-row items-center gap-4">
        <Mascot size={72} mood="wow" />
        <View className="flex-1 gap-1">
          <Text variant="headline">{t.reminderTitle}</Text>
          <Text variant="caption" tone="secondary">
            {teen ? v2.teen.reminderBody : t.reminderBody}
          </Text>
        </View>
      </Card>

      {kidId ? (
        <ListGroup title={t.recentTitle}>
          <ListRow
            icon="timer"
            iconTone="blue"
            title={t.lastBrushing}
            subtitle={last ? formatDateTime(last.startedAt) : t.noBrushingYet}
            value={last ? formatClock(last.durationS) : undefined}
            onPress={lastHref ? () => router.push(lastHref) : undefined}
          />
        </ListGroup>
      ) : null}
    </Screen>
  );
}
