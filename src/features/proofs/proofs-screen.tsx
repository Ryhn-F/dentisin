import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { Banner } from '@/components/banner';
import { Card } from '@/components/card';
import { ChildSwitcher } from '@/components/child-switcher';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { IconTile } from '@/components/icon-tile';
import { Button } from '@/components/ui/button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { useLimits } from '@/core/account/account-store';
import { deleteBrushingProof, listBrushingProofs, type ApiErrorCode } from '@/core/account/api';
import { id } from '@/core/i18n/id';
import { palette } from '@/core/theme';
import { useLocalData } from '@/data/local-store';
import type { BrushingProof } from '@/domain/models';
import { formatDateTime } from '@/ui/format';

import { DeleteConfirm } from './delete-confirm';
import {
  PAGE_SIZE,
  appendPage,
  daysUntilExpiry,
  formatMegabytes,
  mayHaveMore,
  nextCursor,
  proofErrorKind,
} from './proof-flow';
import { useProofChildren } from './use-proof-children';

const t = id.proofs.list;

function NewTag() {
  return (
    <View className="rounded-full bg-primary px-2.5 py-0.5" testID="proof-new-tag">
      <Text variant="label" tone="onPrimary" style={{ fontSize: 12, lineHeight: 16 }}>
        {t.isNew}
      </Text>
    </View>
  );
}

type RowProps = {
  proof: BrushingProof;
  confirming: boolean;
  busy: boolean;
  failed: boolean;
  onOpen: () => void;
  onAskDelete: () => void;
  onConfirmDelete: () => void;
  onKeep: () => void;
};

// One clip: date, length, size, "Baru" until it was watched, and the retention countdown.
function ProofRow({ proof, confirming, busy, failed, onOpen, onAskDelete, onConfirmDelete, onKeep }: RowProps) {
  const when = formatDateTime(proof.uploadedAt);
  const duration = t.duration(proof.durationS);
  const isNew = proof.viewedAt === null;
  const playable = proof.objectPresent;
  const days = daysUntilExpiry(proof.expiresAt);

  return (
    <Card className="gap-3 p-4" testID={`proof-card-${proof.id}`}>
      <PressableScale
        testID={`proof-open-${proof.id}`}
        accessibilityRole="button"
        accessibilityLabel={`${t.rowLabel(when, duration, isNew && playable)}${playable ? '' : `. ${t.notUploaded}`}`}
        accessibilityHint={playable ? t.play : t.notUploadedHint}
        accessibilityState={{ disabled: !playable }}
        disabled={!playable}
        onPress={onOpen}
        scaleTo={1}
        className="flex-row items-center gap-3"
        minHeight={56}
      >
        <IconTile name={playable ? 'play-arrow' : 'cloud-upload'} tone={playable ? 'blue' : 'lavender'} size={48} round />
        <View className="flex-1 gap-0.5">
          <View className="flex-row flex-wrap items-center gap-2">
            <Text variant="bodyStrong">{when}</Text>
            {isNew && playable ? <NewTag /> : null}
          </View>
          <Text variant="caption" tone="secondary">
            {`${duration} · ${t.size(formatMegabytes(proof.sizeBytes))}`}
          </Text>
          <Text variant="caption" tone="secondary" testID={`proof-note-${proof.id}`}>
            {playable ? (days === 0 ? t.expiresToday : t.expiresIn(days)) : t.notUploaded}
          </Text>
        </View>
        {playable ? <Icon name="chevron-right" size={26} color={palette.primary} /> : null}
      </PressableScale>

      {confirming ? (
        <DeleteConfirm
          testID={`proof-delete-confirm-${proof.id}`}
          busy={busy}
          failed={failed}
          onConfirm={onConfirmDelete}
          onCancel={onKeep}
        />
      ) : (
        <PressableScale
          testID={`proof-delete-${proof.id}`}
          accessibilityRole="button"
          accessibilityLabel={t.deleteLabel(when)}
          onPress={onAskDelete}
          scaleTo={1}
          className="flex-row items-center gap-2 self-start rounded-full px-3"
          minHeight={48}
        >
          <Icon name="delete-outline" size={22} color={palette.danger} />
          <Text variant="label" style={{ color: palette.danger }}>
            {t.delete}
          </Text>
        </PressableScale>
      )}
    </Card>
  );
}

function ListError({ code, onRetry }: { code: ApiErrorCode; onRetry: () => void }) {
  const kind = proofErrorKind(code);
  const e = t.errors[kind];
  return (
    <EmptyState
      testID={`proofs-error-${kind}`}
      icon={kind === 'network' ? 'cloud-off' : kind === 'forbidden' ? 'lock-outline' : 'info-outline'}
      title={e.title}
      message={e.message}
      action={kind === 'forbidden' ? undefined : { label: t.retry, onPress: onRetry }}
    />
  );
}

// Guardian: the clips of one child (pick the child on top). Teen: own clips only. Newest first,
// "Muat lagi" pages with the keyset cursor `before`. Refreshed every time the screen is focused.
export function ProofsScreen() {
  const { child: childParam } = useLocalSearchParams<{ child?: string }>();
  const { children, labelFor, isTeen } = useProofChildren();
  const activeChildId = useLocalData((s) => s.activeChildId);
  const limits = useLimits();

  const [picked, setPicked] = useState<string | null>(null);
  // List and error are tagged with their child, so a switch never shows the previous child's clips.
  const [data, setData] = useState<{ childId: string; items: BrushingProof[]; hasMore: boolean } | null>(null);
  const [failure, setFailure] = useState<{ childId: string; code: ApiErrorCode } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const loadSeq = useRef(0);

  // Child choice: the route param (opened from a child card), then the picker, then the active child.
  const fromParam = typeof childParam === 'string' && childParam.length > 0 ? childParam : null;
  const childId = useMemo(() => {
    if (isTeen) return children[0]?.id ?? null;
    if (fromParam) return fromParam;
    if (picked && children.some((c) => c.id === picked)) return picked;
    if (activeChildId && children.some((c) => c.id === activeChildId)) return activeChildId;
    return children[0]?.id ?? null;
  }, [isTeen, children, fromParam, picked, activeChildId]);

  const items = data && data.childId === childId ? data.items : null;
  const hasMore = data && data.childId === childId ? data.hasMore : false;
  const error = failure && failure.childId === childId ? failure.code : null;

  const load = useCallback(async () => {
    if (!childId) return;
    const seq = ++loadSeq.current;
    const res = await listBrushingProofs({ childId, limit: PAGE_SIZE });
    if (seq !== loadSeq.current) return; // a newer load (or another child) owns the screen
    if (res.ok) {
      setData({ childId, items: res.data, hasMore: mayHaveMore(res.data) });
      setFailure(null);
      setMoreFailed(false);
    } else {
      setFailure({ childId, code: res.code });
    }
  }, [childId]);

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

  async function loadMore() {
    if (!childId || !items || loadingMore) return;
    const seq = loadSeq.current;
    setLoadingMore(true);
    setMoreFailed(false);
    const res = await listBrushingProofs({ childId, before: nextCursor(items), limit: PAGE_SIZE });
    if (seq !== loadSeq.current) {
      setLoadingMore(false);
      return;
    }
    setLoadingMore(false);
    if (res.ok) {
      setData((cur) =>
        cur && cur.childId === childId
          ? { childId, items: appendPage(cur.items, res.data), hasMore: mayHaveMore(res.data) }
          : cur,
      );
    } else {
      setMoreFailed(true);
    }
  }

  async function remove(proof: BrushingProof) {
    setBusyId(proof.id);
    setFailedId(null);
    const res = await deleteBrushingProof(proof.id);
    setBusyId(null);
    if (res.ok) {
      setConfirmingId(null);
      setData((cur) => (cur ? { ...cur, items: cur.items.filter((p) => p.id !== proof.id) } : cur));
    } else {
      setFailedId(proof.id);
    }
  }

  function open(proof: BrushingProof) {
    if (!proof.objectPresent) return;
    router.push({ pathname: '/proofs/[id]', params: { id: proof.id, child: proof.childId } });
  }

  const loading = childId !== null && items === null && error === null;
  const hardError = items === null && error !== null;
  const showPicker = !isTeen && !fromParam && children.length > 1;
  const pickerOptions = useMemo(
    () => children.map((c) => ({ id: c.id, nickname: labelFor(c.id) })),
    [children, labelFor],
  );

  return (
    <ScrollView
      testID="proofs-scroll"
      className="flex-1 bg-bg"
      contentContainerClassName="gap-5 px-5 pb-12 pt-4"
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
      <Banner
        tone="info"
        icon="lock-outline"
        message={isTeen ? t.privacyTeen(limits.proofRetentionDays) : t.privacyGuardian(limits.proofRetentionDays)}
        testID="proofs-privacy"
      />

      {showPicker ? (
        <View className="gap-1" testID="proofs-picker">
          <Text variant="label" tone="secondary">
            {t.childPicker}
          </Text>
          <ChildSwitcher kids={pickerOptions} activeId={childId} onChange={setPicked} />
        </View>
      ) : null}

      {childId && !isTeen && (fromParam || children.length <= 1) ? (
        <Text variant="title" accessibilityRole="header" testID="proofs-child-title">
          {t.forChild(labelFor(childId))}
        </Text>
      ) : null}

      {childId === null ? (
        <EmptyState
          mascot="thinking"
          title={isTeen ? t.emptyTitle : t.noChildTitle}
          message={isTeen ? t.emptyTeen : t.noChildBody}
          testID="proofs-no-child"
        />
      ) : null}

      {loading ? (
        <Text variant="body" tone="secondary" className="py-10 text-center" accessibilityLiveRegion="polite" testID="proofs-loading">
          {t.loading}
        </Text>
      ) : null}

      {hardError && error ? <ListError code={error} onRetry={() => void load()} /> : null}

      {items !== null ? (
        <>
          {error ? (
            <Banner
              tone="warning"
              message={t.refreshFailed}
              testID="proofs-refresh-failed"
              action={<Button title={t.retry} variant="ghost" className="self-start" onPress={() => void load()} />}
            />
          ) : null}

          {items.length === 0 ? (
            <EmptyState
              mascot="happy"
              title={t.emptyTitle}
              message={isTeen ? t.emptyTeen : t.emptyGuardian}
              testID="proofs-empty"
            />
          ) : (
            <View className="gap-3" testID="proofs-list">
              {items.map((proof) => (
                <ProofRow
                  key={proof.id}
                  proof={proof}
                  confirming={confirmingId === proof.id}
                  busy={busyId === proof.id}
                  failed={failedId === proof.id}
                  onOpen={() => open(proof)}
                  onAskDelete={() => {
                    setFailedId(null);
                    setConfirmingId(proof.id);
                  }}
                  onConfirmDelete={() => void remove(proof)}
                  onKeep={() => setConfirmingId(null)}
                />
              ))}
            </View>
          )}

          {hasMore ? (
            <View className="gap-2">
              {moreFailed ? <Banner tone="warning" message={t.loadMoreFailed} testID="proofs-more-failed" /> : null}
              <Button
                testID="proofs-load-more"
                title={loadingMore ? t.loadingMore : t.loadMore}
                variant="secondary"
                loading={loadingMore}
                onPress={() => void loadMore()}
              />
            </View>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
