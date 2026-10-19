import { router } from 'expo-router';
import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { Card } from '@/components/card';
import { Blob } from '@/components/decor';
import { Icon } from '@/components/icon';
import { HeroHeader } from '@/components/hero-header';
import { IconTile } from '@/components/icon-tile';
import { ListGroup, ListRow } from '@/components/list-group';
import { Mascot } from '@/components/mascot';
import { Screen } from '@/components/screen';
import { StreakCounter } from '@/components/streak';
import { Button } from '@/components/ui/button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text, TextClassContext } from '@/components/ui/text';
import { useMe } from '@/core/account/account-store';
import { useSession } from '@/core/auth/session-store';
import { id } from '@/core/i18n/id';
import { palette, shadows, useTheme, useIsScreenFocused } from '@/core/theme';
import { weekDots } from '@/features/home/streak';
import { useForegroundPoll } from '@/features/home/use-foreground-poll';
import { useBrushingStreak, useKidRequests, type KidRequestsState } from '@/features/home/use-home-data';
import { WeekDots } from '@/features/home/week-dots';

import { hasOpenSwelling, kidAccountView, kidRequestRow } from './kid-home-logic';

const t = id.kid.home;
const r = id.kid.requests;

function KidRequests({ state }: { state: KidRequestsState }) {
  if (state.status === 'ready' && state.items.length > 0) {
    return (
      <ListGroup title={r.title}>
        {state.items.map((item) => {
          const row = kidRequestRow(item);
          return (
            <ListRow
              key={item.id}
              testID={`kid-request-${item.id}`}
              icon={row.icon}
              iconTone={item.status === 'done' ? 'mint' : 'lavender'}
              title={row.title}
              subtitle={row.subtitle}
              accessibilityLabel={row.label}
            />
          );
        })}
      </ListGroup>
    );
  }
  let message: string;
  if (state.status === 'loading') message = t.loading;
  else if (state.status === 'unavailable') message = r.unavailable;
  else if (state.status === 'error') message = r.error;
  else message = r.empty;
  return (
    <ListGroup title={r.title}>
      <ListRow testID="kid-requests-empty" icon="inbox" iconTone="lavender" title={message} />
    </ListGroup>
  );
}

// Home of a child account (/kid; ADR 017, ACCOUNTS_AND_FLOWS.md §10 "Anak"): streak, start
// brushing, "Gigiku sakit", and the child's own requests (status only). Grade-4 words. Never
// shows screening results, photos, referrals, settings or deletion: the guardian screens.
export function KidHomeScreen() {
  const focused = useIsScreenFocused();
  const { touch } = useTheme();
  const me = useMe();
  const status = useSession((s) => s.status);
  const kid = kidAccountView(me);
  const childId = kid?.childId ?? null;
  // Legacy backend: none of the v2 RPCs exist (a child account cannot exist there either).
  const remote = status === 'signedIn' && kid !== null && !me?.legacy;

  const streak = useBrushingStreak(childId, remote);
  const requests = useKidRequests(childId, remote);
  useForegroundPoll(() => Promise.all([streak.refresh(), requests.refresh()]), {
    enabled: remote,
    restartKey: childId,
  });

  const items = requests.state.status === 'ready' ? requests.state.items : [];
  const swelling = hasOpenSwelling(items);

  return (
    <Screen flush topScrim={{ color: 'primary', height: 'statusBar' }} testID="kid-home">
      <HeroHeader withNavHeader={false}>
        <View className="flex-row items-center gap-4">
          <View className="size-20 items-center justify-center rounded-full bg-card">
            <Mascot size={70} mood="happy" />
          </View>
          <View className="flex-1 gap-1">
            <Text variant="title" accessibilityRole="header" numberOfLines={2}>
              {kid?.username ? t.hello(kid.username) : t.helloNoName}
            </Text>
            <Text variant="body">{t.intro}</Text>
          </View>
        </View>
      </HeroHeader>

      <View className="gap-6 px-5">
        {/* Red flag first: a swelling request still open keeps the local advice on top. */}
        {swelling ? (
          <Banner testID="kid-swelling" tone="error" icon="local-hospital" title={r.swellingTitle} message={r.swellingBody} />
        ) : null}

        {kid && !kid.syncAllowed ? (
          <Banner testID="kid-sync-off" tone="warning" icon="lock-outline" title={t.syncOffTitle} message={t.syncOffBody} />
        ) : null}

        <Card tone="blue" className="gap-5 p-6" testID="kid-streak">
          <Blob color={palette.coral} size={150} variant={0} style={{ right: -50, top: -50 }} />
          <Blob color={palette.primaryDeep} size={200} variant={2} opacity={0.7} style={{ left: -90, bottom: -120 }} />
          <View className="flex-row items-center justify-between">
            <View className="gap-2">
              <Text variant="label">{t.streakTitle}</Text>
              <StreakCounter count={streak.streak.current} active={focused} />
            </View>
            <Mascot size={96} withBrush mood={streak.streak.todayDone ? 'wow' : 'happy'} />
          </View>
          <Text variant="bodyStrong" testID="kid-streak-today">
            {streak.streak.todayDone ? t.todayDone : t.todayNotYet}
          </Text>
          <WeekDots days={weekDots(streak.streak)} doneLabel={t.dayDone} notYetLabel={t.dayNotYet} big />
        </Card>

        <Button
          testID="kid-brush-now"
          title={t.brushNow}
          icon="play-arrow"
          variant="accent"
          size="large"
          accessibilityHint={t.brushNowHint}
          onPress={() => router.push('/brushing/session')}
        />

        {/* "Gigiku sakit": big coral tile -> the picture-based request flow. */}
        <TextClassContext.Provider value="text-coral-on">
          <PressableScale
            testID="kid-toothache"
            accessibilityRole="button"
            accessibilityLabel={`${t.toothache}. ${t.toothacheHint}`}
            onPress={() => router.push('/requests/new')}
            minHeight={touch.large * 1.5}
            className="flex-row items-center gap-4 overflow-hidden rounded-card bg-coral p-5"
            style={{ borderCurve: 'continuous', boxShadow: shadows.button }}
          >
            <IconTile name="sentiment-dissatisfied" tone="white" size={60} round />
            <View className="flex-1 gap-1">
              <Text variant="headline">{t.toothache}</Text>
              <Text variant="caption">{t.toothacheHint}</Text>
            </View>
            <View className="size-11 items-center justify-center rounded-full bg-card">
              <Icon name="arrow-forward" size={22} color={palette.coral} />
            </View>
          </PressableScale>
        </TextClassContext.Provider>

        {kid?.proofAllowed ? (
          <Card tone="mint" className="flex-row items-center gap-3" testID="kid-proof-hint">
            <IconTile name="videocam" tone="white" size={44} round />
            <Text variant="body" className="flex-1">
              {t.proofHint}
            </Text>
          </Card>
        ) : null}

        <KidRequests state={requests.state} />
      </View>
    </Screen>
  );
}
