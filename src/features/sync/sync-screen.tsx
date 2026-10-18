import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { Card } from '@/components/card';
import { ListGroup, ListRow } from '@/components/list-group';
import { Screen } from '@/components/screen';
import { SyncStatusPill } from '@/components/sync-status-pill';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useSession } from '@/core/auth/session-store';
import { id } from '@/core/i18n/id';
import { outbox, useOutboxStatus, type OutboxEntry } from '@/core/sync/outbox';
import { rejectionMessage, useSyncMessage, useSyncStatus } from '@/core/sync/use-sync-status';
import { useLocalData } from '@/data/local-store';
import { homeChildren } from '@/features/home/banners';
import { formatDateTime } from '@/ui/format';

const t = id.syncV2;

/** Rejected / held outbox entries, re-read on every outbox notice. */
function useAttentionEntries(): OutboxEntry[] {
  const [entries, setEntries] = useState(() => outbox.needsAttention());
  useEffect(() => outbox.subscribe(() => setEntries(outbox.needsAttention())), []);
  return entries;
}

// Sync status of this phone (SYNC_EVENTS.md): what is waiting, when it last went out, "send
// now", and the events the server refused with the reason in plain words. Dismissing an entry
// only removes it from this list (a corrected record is sent as a NEW event).
export function SyncScreen() {
  const session = useSession((s) => s.status);
  const status = useSyncStatus();
  const message = useSyncMessage();
  const lastSuccessAt = useOutboxStatus((s) => s.lastSuccessAt);
  const syncing = useOutboxStatus((s) => s.syncing);
  const pending = useOutboxStatus((s) => s.pending);
  const kids = useLocalData((s) => s.kids);
  const entries = useAttentionEntries();
  const signedIn = session === 'signedIn';

  const labels = useMemo(() => new Map(homeChildren(kids).map((c) => [c.id, c.label])), [kids]);
  const childLabel = (childId: string) => labels.get(childId) ?? id.homeV2.fallbackNameUnknown;

  return (
    <Screen testID="sync-screen">
      <Card className="gap-3">
        <View className="flex-row items-center justify-between gap-3">
          <Text variant="headline">{t.statusTitle}</Text>
          <SyncStatusPill status={status} />
        </View>
        {message ? (
          <Text variant="body" tone="secondary" testID="sync-message">
            {message}
          </Text>
        ) : null}
        {signedIn ? (
          <Text variant="caption" tone="secondary" testID="sync-last">
            {lastSuccessAt ? t.lastSynced(formatDateTime(new Date(lastSuccessAt).toISOString())) : t.neverSynced}
          </Text>
        ) : null}
        {signedIn ? (
          <Button
            testID="sync-now"
            title={t.syncNow}
            accessibilityHint={t.syncNowLabel}
            icon="sync"
            variant="secondary"
            loading={syncing}
            disabled={pending === 0}
            onPress={() => void outbox.flush({ ignoreBackoff: true })}
          />
        ) : null}
      </Card>

      {signedIn ? (
        entries.length ? (
          <ListGroup title={t.attentionTitle}>
            {entries.map((e) => {
              const what = t.types[e.type];
              const child = childLabel(e.childId);
              const time = formatDateTime(e.createdAt);
              const reason = rejectionMessage(e.state === 'held' ? 'dependency_rejected' : e.code);
              return (
                <ListRow
                  key={e.eventId}
                  testID={`sync-entry-${e.eventId}`}
                  icon="sync-problem"
                  iconTone="coral"
                  title={what}
                  subtitle={`${child} · ${time}\n${reason}`}
                  accessibilityLabel={`${t.entryLabel(what, child, time)}. ${reason}`}
                  accessory={
                    <Button
                      testID={`sync-dismiss-${e.eventId}`}
                      title={t.dismiss}
                      accessibilityHint={t.dismissLabel}
                      variant="ghost"
                      onPress={() => outbox.dismiss(e.eventId, { giveUp: true })}
                    />
                  }
                />
              );
            })}
          </ListGroup>
        ) : (
          <Banner tone="success" icon="cloud-done" message={t.attentionEmpty} testID="sync-attention-empty" />
        )
      ) : null}
    </Screen>
  );
}
