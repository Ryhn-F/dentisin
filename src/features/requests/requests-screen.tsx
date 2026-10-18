import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { Banner } from '@/components/banner';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { IconTile } from '@/components/icon-tile';
import { ListGroup, ListRow } from '@/components/list-group';
import { Button } from '@/components/ui/button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { ackScreeningRequest, listChildren, listScreeningRequests, type ApiErrorCode } from '@/core/account/api';
import { flags } from '@/core/flags';
import { id } from '@/core/i18n/id';
import { palette, useTheme } from '@/core/theme';
import { useLocalData } from '@/data/local-store';
import type { RequestStatus, ScreeningRequest } from '@/domain/models';
import { formatDateTime } from '@/ui/format';

import {
  childLabeler,
  closedStatuses,
  daysUntilExpiry,
  groupByChild,
  isOpenStatus,
  listErrorKind,
  openStatuses,
  reasonLook,
  requestUrgency,
} from './request-flow';

const t = id.requests.list;

const OPEN_LIMIT = 50;
const CLOSED_LIMIT = 20;

const closedLabel: Record<RequestStatus, string> = {
  pending: t.statusNew,
  seen: t.statusSeen,
  done: t.statusDone,
  cancelled: t.statusCancelled,
  expired: t.statusExpired,
};

function Tag({ label, tone }: { label: string; tone: 'new' | 'urgent' }) {
  return (
    <View
      className={tone === 'urgent' ? 'rounded-full bg-level-emergency px-2.5 py-0.5' : 'rounded-full bg-primary px-2.5 py-0.5'}
      testID={tone === 'urgent' ? 'request-urgent-tag' : 'request-new-tag'}
    >
      <Text variant="label" tone="onPrimary" style={{ fontSize: 12, lineHeight: 16 }}>
        {label}
      </Text>
    </View>
  );
}

type CardProps = {
  item: ScreeningRequest;
  expanded: boolean;
  confirming: boolean;
  busy: boolean;
  failed: boolean;
  onToggle: () => void;
  onCheck: () => void;
  onAskCancel: () => void;
  onConfirmCancel: () => void;
  onKeep: () => void;
};

// One open request. Opening it marks it as seen on the server (done by the screen).
function RequestCard({ item, expanded, confirming, busy, failed, onToggle, onCheck, onAskCancel, onConfirmCancel, onKeep }: CardProps) {
  const look = reasonLook[item.reasonCode];
  const label = t.reasons[item.reasonCode];
  const urgency = requestUrgency(item.reasonCode, item.painLevel);
  const urgent = urgency !== null;
  const days = daysUntilExpiry(item.expiresAt);
  const pain = item.painLevel === null ? t.painUnknown : t.painKnown(item.painLevel);
  const when = formatDateTime(item.createdAt);

  return (
    <Card className="gap-3 p-4" testID={`request-card-${item.id}`}>
      <PressableScale
        testID={`request-toggle-${item.id}`}
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${pain}. ${t.sentAt(when)}. ${expanded ? t.close : t.open}`}
        accessibilityState={{ expanded }}
        onPress={onToggle}
        scaleTo={1}
        className="flex-row items-center gap-3"
        minHeight={56}
      >
        <IconTile name={look.icon} tone={look.tone} size={48} round />
        <View className="flex-1 gap-0.5">
          <View className="flex-row flex-wrap items-center gap-2">
            <Text variant="bodyStrong">{label}</Text>
            {urgent ? <Tag label={t.urgentTag} tone="urgent" /> : null}
            {item.status === 'pending' ? <Tag label={t.statusNew} tone="new" /> : null}
          </View>
          <Text variant="caption" tone="secondary">
            {`${pain} · ${when}`}
          </Text>
        </View>
        <Icon name={expanded ? 'expand-less' : 'expand-more'} size={26} color={palette.primary} />
      </PressableScale>

      {/* Local advice, not a diagnosis: swelling is a red flag and always wins; severe pain is
          urgent by the triage rules (PAIN_HIGH). */}
      {urgent ? (
        <Banner tone="error" icon="priority-high" message={urgency === 'swelling' ? t.urgentAdvice : t.urgentPainAdvice} />
      ) : null}

      {expanded ? (
        <View className="gap-3">
          <Text variant="caption" tone="secondary">
            {days === 0 ? t.expiresToday : t.expiresIn(days)}
          </Text>
          {confirming ? (
            <View className="gap-3 rounded-tile bg-tint-lavender p-4" style={{ borderCurve: 'continuous' }}>
              <Text variant="bodyStrong">{t.confirmTitle}</Text>
              <Text variant="caption">{urgent ? t.confirmBodyUrgent : t.confirmBody}</Text>
              <View className="flex-row flex-wrap gap-2">
                <Button testID={`request-confirm-${item.id}`} title={t.confirmYes} variant="danger" loading={busy} onPress={onConfirmCancel} />
                <Button title={t.confirmNo} variant="secondary" disabled={busy} onPress={onKeep} />
              </View>
            </View>
          ) : (
            <View className="gap-2">
              <Button
                testID={`request-check-${item.id}`}
                title={t.checkNow}
                icon="photo-camera"
                variant="accent"
                accessibilityHint={t.checkNowHint}
                onPress={onCheck}
              />
              <Button testID={`request-cancel-${item.id}`} title={t.notNeeded} variant="ghost" onPress={onAskCancel} />
              {!flags.medical_modules ? (
                <Text variant="caption" tone="secondary">
                  {t.screeningOffNote}
                </Text>
              ) : null}
            </View>
          )}
          {failed ? <Banner tone="error" message={t.actionFailed} /> : null}
        </View>
      ) : null}
    </Card>
  );
}

function ListError({ code, onRetry }: { code: ApiErrorCode; onRetry: () => void }) {
  const kind = listErrorKind(code);
  const e = t.errors[kind];
  return (
    <EmptyState
      testID={`requests-error-${kind}`}
      icon={kind === 'network' ? 'cloud-off' : kind === 'forbidden' ? 'lock-outline' : 'info-outline'}
      title={e.title}
      message={e.message}
      action={kind === 'forbidden' ? undefined : { label: t.retry, onPress: onRetry }}
    />
  );
}

// Guardian: requests from child accounts (§2.5). Open items first, grouped by child, then a
// collapsed "Selesai" section. Pull to refresh; refreshed again every time the screen is focused.
export function RequestsScreen() {
  const kids = useLocalData((s) => s.kids);
  const { touch } = useTheme();
  const [open, setOpen] = useState<ScreeningRequest[] | null>(null);
  const [closed, setClosed] = useState<ScreeningRequest[]>([]);
  const [error, setError] = useState<ApiErrorCode | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const loadSeq = useRef(0);
  const acking = useRef(new Set<string>());

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const [o, c, kids] = await Promise.all([
      listScreeningRequests({ statuses: openStatuses, limit: OPEN_LIMIT }),
      listScreeningRequests({ statuses: closedStatuses, limit: CLOSED_LIMIT }),
      listChildren(),
    ]);
    // A request can come from a child added on another phone: adopt the server children so
    // "Periksa sekarang" finds that child locally (the screening tab ignores unknown children).
    if (kids.ok) useLocalData.getState().mergeServerChildren(kids.data);
    if (seq !== loadSeq.current) return; // a newer load owns the screen
    if (o.ok) {
      setOpen(o.data);
      setError(null);
    } else {
      setError(o.code);
    }
    if (c.ok) setClosed(c.data);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  // Moves a request between the lists after the server confirmed its new status.
  function applyStatus(requestId: string, status: RequestStatus, seenAt: string | null, respondedAt: string | null) {
    const patch = (r: ScreeningRequest): ScreeningRequest => ({ ...r, status, seenAt: seenAt ?? r.seenAt, respondedAt: respondedAt ?? r.respondedAt });
    if (isOpenStatus(status)) {
      setOpen((list) => list?.map((r) => (r.id === requestId ? patch(r) : r)) ?? list);
      return;
    }
    const moved = open?.find((r) => r.id === requestId);
    setOpen((list) => list?.filter((r) => r.id !== requestId) ?? list);
    if (moved) setClosed((list) => [patch(moved), ...list.filter((r) => r.id !== requestId)]);
  }

  async function markSeen(item: ScreeningRequest) {
    if (item.status !== 'pending' || acking.current.has(item.id)) return;
    acking.current.add(item.id);
    try {
      const res = await ackScreeningRequest(item.id, 'seen');
      // A failed ack is silent: the request is simply marked again the next time it is opened.
      if (res.ok) applyStatus(item.id, res.data.status, res.data.seenAt, res.data.respondedAt);
    } finally {
      acking.current.delete(item.id);
    }
  }

  function toggle(item: ScreeningRequest) {
    const willOpen = !expanded.has(item.id);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (willOpen) next.add(item.id);
      else next.delete(item.id);
      return next;
    });
    if (!willOpen) {
      if (confirmingId === item.id) setConfirmingId(null);
      return;
    }
    void markSeen(item);
  }

  async function cancel(item: ScreeningRequest) {
    setBusyId(item.id);
    setFailedId(null);
    const res = await ackScreeningRequest(item.id, 'cancel');
    setBusyId(null);
    if (res.ok) {
      setConfirmingId(null);
      applyStatus(item.id, res.data.status, res.data.seenAt, res.data.respondedAt);
    } else {
      setFailedId(item.id);
    }
  }

  // CONTRACT: the screening tab reads the params `child` and `request`; the finished screening
  // carries the request id so the server closes the request (screening_recorded.request_id).
  function checkNow(item: ScreeningRequest) {
    router.push({ pathname: '/screening', params: { child: item.childId, request: item.id } });
  }

  const labelFor = useMemo(
    () => childLabeler(kids, [...(open ?? []), ...closed].map((r) => r.childId), t.childFallback),
    [kids, open, closed],
  );
  const groups = useMemo(() => groupByChild(open ?? []), [open]);
  const loading = open === null && error === null;
  const hardError = open === null && error !== null;

  return (
    <ScrollView
      testID="requests-scroll"
      className="flex-1 bg-bg"
      contentContainerClassName="gap-6 px-5 pb-12 pt-4"
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          colors={[palette.primary]}
          accessibilityLabel={t.refresh}
        />
      }
    >
      {loading ? (
        <Text variant="body" tone="secondary" className="py-10 text-center" accessibilityLiveRegion="polite" testID="requests-loading">
          {t.loading}
        </Text>
      ) : null}

      {hardError && error ? <ListError code={error} onRetry={() => void load()} /> : null}

      {open !== null ? (
        <>
          <Text variant="body" tone="secondary">
            {t.intro}
          </Text>

          {error ? (
            <Banner
              tone="warning"
              message={t.refreshFailed}
              testID="requests-refresh-failed"
              action={<Button title={t.retry} variant="ghost" className="self-start" onPress={() => void load()} />}
            />
          ) : null}

          {open.length === 0 ? (
            <EmptyState mascot="happy" title={t.emptyTitle} message={t.emptyBody} testID="requests-empty" />
          ) : (
            groups.map((group) => (
              <View key={group.childId} className="gap-3" testID={`request-group-${group.childId}`}>
                <Text variant="title" accessibilityRole="header">
                  {labelFor(group.childId)}
                </Text>
                {group.items.map((item) => (
                  <RequestCard
                    key={item.id}
                    item={item}
                    expanded={expanded.has(item.id)}
                    confirming={confirmingId === item.id}
                    busy={busyId === item.id}
                    failed={failedId === item.id}
                    onToggle={() => toggle(item)}
                    onCheck={() => checkNow(item)}
                    onAskCancel={() => {
                      setFailedId(null);
                      setConfirmingId(item.id);
                    }}
                    onConfirmCancel={() => void cancel(item)}
                    onKeep={() => setConfirmingId(null)}
                  />
                ))}
              </View>
            ))
          )}

          {closed.length > 0 ? (
            <View className="gap-3" testID="requests-closed">
              <PressableScale
                testID="requests-closed-toggle"
                accessibilityRole="button"
                accessibilityLabel={`${t.doneTitle(closed.length)}. ${showClosed ? t.doneToggleHide : t.doneToggleShow}`}
                accessibilityState={{ expanded: showClosed }}
                onPress={() => setShowClosed((v) => !v)}
                scaleTo={1}
                className="flex-row items-center justify-between rounded-card bg-card px-4"
                minHeight={touch.regular}
              >
                <Text variant="headline">{t.doneTitle(closed.length)}</Text>
                <Icon name={showClosed ? 'expand-less' : 'expand-more'} size={26} color={palette.primary} />
              </PressableScale>
              {showClosed ? (
                <ListGroup>
                  {closed.map((item) => (
                    <ListRow
                      key={item.id}
                      testID={`request-closed-${item.id}`}
                      icon={reasonLook[item.reasonCode].icon}
                      iconTone="lavender"
                      title={t.reasons[item.reasonCode]}
                      subtitle={`${labelFor(item.childId)} · ${formatDateTime(item.createdAt)}`}
                      value={closedLabel[item.status]}
                    />
                  ))}
                </ListGroup>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
