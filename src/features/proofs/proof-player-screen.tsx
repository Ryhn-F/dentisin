import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Banner } from '@/components/banner';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import {
  deleteBrushingProof,
  listBrushingProofs,
  markProofViewed,
  proofSignedUrl,
  type ApiErrorCode,
} from '@/core/account/api';
import { id } from '@/core/i18n/id';
import { palette } from '@/core/theme';
import type { BrushingProof } from '@/domain/models';
import { formatDateTime } from '@/ui/format';

import { DeleteConfirm } from './delete-confirm';
import {
  MAX_LOOKUP_PAGES,
  daysUntilExpiry,
  formatMegabytes,
  isUrlFresh,
  mayHaveMore,
  nextCursor,
  playErrorKind,
  proofErrorKind,
} from './proof-flow';
import { useProofChildren } from './use-proof-children';

const t = id.proofs.player;
const tl = id.proofs.list;

const LOOKUP_LIMIT = 50;

type Lookup =
  | { state: 'loading' }
  | { state: 'ready'; proof: BrushingProof }
  | { state: 'missing' }
  | { state: 'error'; code: ApiErrorCode };

/** Finds one proof by paging through the lists of the candidate children (the server has no get-by-id). */
async function findProof(childIds: readonly string[], proofId: string): Promise<Lookup> {
  let lastError: ApiErrorCode | null = null;
  let anyOk = false;
  for (const childId of childIds) {
    let before: string | undefined;
    for (let page = 0; page < MAX_LOOKUP_PAGES; page++) {
      const res = await listBrushingProofs({ childId, before, limit: LOOKUP_LIMIT });
      if (!res.ok) {
        lastError = res.code;
        break;
      }
      anyOk = true;
      const hit = res.data.find((p) => p.id === proofId);
      if (hit) return { state: 'ready', proof: hit };
      if (!mayHaveMore(res.data, LOOKUP_LIMIT)) break;
      before = nextCursor(res.data);
    }
  }
  if (!anyOk && lastError) return { state: 'error', code: lastError };
  return { state: 'missing' };
}

/** Seeks the native player (kept outside the component: the player is a native object, not React state). */
function seekTo(p: VideoPlayer, seconds: number) {
  p.currentTime = seconds;
}

type Phase = 'idle' | 'preparing' | 'ready' | 'error';

// Watch one clip. The signed URL (300 s) is made only when the viewer taps play, kept in a
// local variable of the player call (never in state, storage or logs), and replaced by a new one
// whenever playback starts after it grew older than URL_MAX_AGE_MS. markProofViewed runs once,
// when playback first starts. Native controls only: no download or share.
export function ProofPlayerScreen() {
  const { id: proofId, child: childParam } = useLocalSearchParams<{ id?: string; child?: string }>();
  const { children } = useProofChildren();

  const [lookup, setLookup] = useState<Lookup>({ state: 'loading' });
  const [phase, setPhase] = useState<Phase>('idle');
  const [playError, setPlayError] = useState<ApiErrorCode | null>(null);
  const [viewedAt, setViewedAt] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);

  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
  });

  const alive = useRef(true);
  const issuedAt = useRef<number | null>(null);
  const preparing = useRef(false);
  const markedViewed = useRef(false);
  const proofRef = useRef<BrushingProof | null>(null);
  const loadSeq = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const wantedId = typeof proofId === 'string' ? proofId : '';
  const wantedChild = typeof childParam === 'string' && childParam.length > 0 ? childParam : null;
  const candidateKey = wantedChild ?? children.map((c) => c.id).join(',');

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const childIds = wantedChild ? [wantedChild] : candidateKey.split(',').filter(Boolean);
    const result = wantedId && childIds.length > 0 ? await findProof(childIds, wantedId) : ({ state: 'missing' } as const);
    if (!alive.current || seq !== loadSeq.current) return;
    setLookup((cur) => {
      // A refetch while the clip is open must not reset playback: keep the proof we already have
      // unless the server stopped listing it or failed hard.
      if (result.state === 'error' && cur.state === 'ready') return cur;
      return result;
    });
    if (result.state === 'ready') {
      proofRef.current = result.proof;
      setViewedAt((cur) => cur ?? result.proof.viewedAt);
    }
  }, [wantedChild, wantedId, candidateKey]);

  // Refetch on every focus: the list is the only source of the proof (status, expiry, presence).
  useFocusEffect(
    useCallback(() => {
      void load();
      // Leaving the screen stops the sound and picture at once.
      return () => {
        try {
          player.pause();
        } catch {
          // The native player may already be released while the screen unmounts.
        }
      };
    }, [load, player]),
  );

  // Creates a new signed URL and loads it into the player. `resumeAt` keeps the position when the
  // old URL expired in the middle of a clip.
  const prepare = useCallback(
    async (resumeAt: number | null) => {
      const proof = proofRef.current;
      if (!proof || preparing.current) return;
      preparing.current = true;
      setPhase('preparing');
      setPlayError(null);
      try {
        const res = await proofSignedUrl(proof.objectPath);
        if (!alive.current) return;
        if (!res.ok) {
          setPlayError(res.code);
          setPhase('error');
          return;
        }
        issuedAt.current = Date.now();
        await player.replaceAsync(res.data);
        if (!alive.current) return;
        if (resumeAt !== null && resumeAt > 0) seekTo(player, resumeAt);
        setPhase('ready');
        player.play();
      } catch {
        if (alive.current) {
          setPlayError('unknown');
          setPhase('error');
        }
      } finally {
        preparing.current = false;
      }
    },
    [player],
  );

  // First time playback runs: tell the server (once). A failed call is retried at the next start.
  const onPlaybackStarted = useCallback(() => {
    const proof = proofRef.current;
    if (!proof) return;
    if (!isUrlFresh(issuedAt.current)) {
      // The viewer pressed play on a paused clip whose URL is too old: swap it for a new one.
      const at = player.currentTime;
      player.pause();
      void prepare(at);
      return;
    }
    if (markedViewed.current || proof.viewedAt !== null) return;
    markedViewed.current = true;
    void markProofViewed(proof.id).then((res) => {
      if (!alive.current) return;
      if (res.ok) setViewedAt(res.data.viewedAt);
      else markedViewed.current = false;
    });
  }, [player, prepare]);

  const onPlayerStatus = useCallback(
    (status: string) => {
      // The player failed to stream (usually an expired URL after a long pause): try once with a new one.
      if (status === 'error' && issuedAt.current !== null && !isUrlFresh(issuedAt.current)) {
        void prepare(player.currentTime);
      } else if (status === 'error') {
        setPlayError('unknown');
        setPhase('error');
      }
    },
    [player, prepare],
  );

  useEffect(() => {
    const subs = [
      player.addListener('playingChange', ({ isPlaying }) => {
        if (isPlaying) onPlaybackStarted();
      }),
      player.addListener('statusChange', ({ status }) => onPlayerStatus(status)),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [player, onPlaybackStarted, onPlayerStatus]);

  async function remove(proof: BrushingProof) {
    setDeleting(true);
    setDeleteFailed(false);
    const res = await deleteBrushingProof(proof.id);
    if (!alive.current) return;
    setDeleting(false);
    if (res.ok) {
      try {
        player.pause();
      } catch {
        // Already released.
      }
      router.back();
    } else {
      setDeleteFailed(true);
    }
  }

  if (lookup.state === 'loading') {
    return (
      <Screen>
        <Text variant="body" tone="secondary" className="py-10 text-center" accessibilityLiveRegion="polite" testID="proof-loading">
          {t.loading}
        </Text>
      </Screen>
    );
  }

  if (lookup.state === 'error') {
    const kind = proofErrorKind(lookup.code);
    const e = tl.errors[kind];
    return (
      <Screen>
        <EmptyState
          testID={`proof-error-${kind}`}
          icon={kind === 'network' ? 'cloud-off' : kind === 'forbidden' ? 'lock-outline' : 'info-outline'}
          title={e.title}
          message={e.message}
          action={kind === 'forbidden' ? undefined : { label: tl.retry, onPress: () => void load() }}
        />
      </Screen>
    );
  }

  if (lookup.state === 'missing') {
    return (
      <Screen>
        <EmptyState
          mascot="thinking"
          title={t.notFoundTitle}
          message={t.notFoundBody}
          action={{ label: t.backToList, onPress: () => router.back() }}
          testID="proof-missing"
        />
      </Screen>
    );
  }

  const proof = lookup.proof;
  const when = formatDateTime(proof.uploadedAt);
  const days = daysUntilExpiry(proof.expiresAt);
  const playable = proof.objectPresent;
  const showVideo = phase === 'preparing' || phase === 'ready';
  const errorKind = playError ? playErrorKind(playError) : null;

  return (
    <Screen>
      <View className="gap-1">
        <Text variant="title" accessibilityRole="header">
          {t.when(when)}
        </Text>
        <Text variant="caption" tone="secondary" testID="proof-meta">
          {`${tl.duration(proof.durationS)} · ${tl.size(formatMegabytes(proof.sizeBytes))}`}
          {viewedAt === null && playable ? ` · ${tl.isNew}` : ''}
        </Text>
      </View>

      {playable ? (
        <View
          className="aspect-[9/16] max-h-[460px] w-full items-center justify-center self-center overflow-hidden rounded-card bg-black"
          style={{ borderCurve: 'continuous' }}
        >
          {showVideo ? (
            <>
              <VideoView
                player={player}
                nativeControls
                fullscreenOptions={{ enable: true }}
                allowsPictureInPicture={false}
                contentFit="contain"
                style={{ width: '100%', height: '100%' }}
                accessibilityLabel={t.videoLabel}
              />
              {phase === 'preparing' ? (
                <View className="absolute inset-0 items-center justify-center gap-2 bg-black/60" testID="proof-preparing">
                  <ActivityIndicator color={palette.onPrimary} />
                  <Text variant="body" tone="onPrimary" accessibilityLiveRegion="polite">
                    {t.preparing}
                  </Text>
                </View>
              ) : null}
            </>
          ) : (
            <PressableScale
              testID="proof-play"
              accessibilityRole="button"
              accessibilityLabel={phase === 'error' ? t.replay : t.play}
              accessibilityHint={t.playHint}
              onPress={() => void prepare(null)}
              className="items-center gap-3 px-6 py-6"
              minHeight={96}
            >
              <View className="size-20 items-center justify-center rounded-full bg-primary">
                <Icon name="play-arrow" size={48} color={palette.onPrimary} />
              </View>
              <Text variant="headline" tone="onPrimary">
                {phase === 'error' ? t.replay : t.play}
              </Text>
            </PressableScale>
          )}
        </View>
      ) : (
        <EmptyState
          icon="cloud-upload"
          title={t.notUploadedTitle}
          message={t.notUploadedBody}
          testID="proof-not-uploaded"
        />
      )}

      {phase === 'error' && errorKind ? (
        <Banner
          tone="error"
          title={t.errors[errorKind].title}
          message={t.errors[errorKind].message}
          testID={`proof-play-error-${errorKind}`}
        />
      ) : null}

      <Card className="gap-2 p-4">
        <Text variant="bodyStrong" testID="proof-retention">
          {days === 0 ? tl.expiresToday : tl.expiresIn(days)}
        </Text>
        <Text variant="caption" tone="secondary">
          {t.privacy}
        </Text>
      </Card>

      {confirming ? (
        <DeleteConfirm
          testID="proof-delete-confirm"
          busy={deleting}
          failed={deleteFailed}
          onConfirm={() => void remove(proof)}
          onCancel={() => {
            setConfirming(false);
            setDeleteFailed(false);
          }}
        />
      ) : (
        <Button
          testID="proof-delete"
          title={tl.delete}
          icon="delete-outline"
          variant="secondary"
          onPress={() => setConfirming(true)}
        />
      )}
    </Screen>
  );
}
