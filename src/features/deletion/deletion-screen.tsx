import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Banner } from '@/components/banner';
import { Card } from '@/components/card';
import { CheckboxField } from '@/components/checkbox-field';
import { EmptyState } from '@/components/empty-state';
import { Icon, type IconName } from '@/components/icon';
import { ListGroup, ListRow } from '@/components/list-group';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useMe } from '@/core/account/account-store';
import { useSession } from '@/core/auth/session-store';
import { id } from '@/core/i18n/id';
import { palette } from '@/core/theme';
import { useLocalData, useLocalReady } from '@/data/local-store';
import type { ChildProfile, ChildSummary, MyAccount } from '@/domain/models';
import { ConfirmPanel } from '@/features/child-accounts/confirm-panel';
import { kidLabel } from '@/features/child-accounts/logic';
import { useChildSummaries } from '@/features/child-accounts/use-child-summaries';

import {
  canRequestDeletion,
  deletionErrorMessage,
  isDeletionPending,
  pendingElsewhere,
  requestAccountDeletion,
  requestChildDeletion,
  selfProfileId,
  type DeletionKind,
} from './deletion-flow';

const t = id.deletion;

function Loading() {
  return (
    <View className="items-center gap-3 py-10" accessibilityLiveRegion="polite" testID="deletion-loading">
      <ActivityIndicator size="large" color={palette.primary} />
      <Text variant="body" tone="secondary">
        {t.gate.loading}
      </Text>
    </View>
  );
}

function Bullets({ items, icon, color, testID }: { items: readonly string[]; icon: IconName; color: string; testID?: string }) {
  return (
    <View className="gap-3" testID={testID}>
      {items.map((item) => (
        <View key={item} className="flex-row items-start gap-3">
          <View className="pt-0.5">
            <Icon name={icon} size={20} color={color} />
          </View>
          <Text variant="body" className="flex-1">
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}

function deletedItems(kind: DeletionKind, me: MyAccount): readonly string[] {
  if (kind === 'child') return t.explain.deleted.child;
  if (kind === 'self') return t.explain.deleted.self;
  return me.accountType === 'teen' ? t.explain.deleted.accountTeen : t.explain.deleted.accountGuardian;
}

function keptItems(me: MyAccount): string[] {
  const k = t.explain.kept;
  // Only guardians have child accounts, whose phones keep their own copies.
  return [k.model, k.shared, me.accountType === 'guardian' ? k.otherPhonesWithKids : k.otherPhones, k.proofRecord];
}

function facts(kind: DeletionKind): string[] {
  const f = t.explain.facts;
  const out: string[] = [f.internet, f.timing, f.final];
  if (kind === 'self') out.push(f.selfKeepsAccount);
  if (kind === 'account') out.push(f.signOut);
  return out;
}

type Target = { kind: 'child' | 'self'; childId: string; name: string } | { kind: 'account'; name: string };

// Step 1: what is deleted and what is not, plus an acknowledgement. Step 2: the final
// confirmation, then the request (run by the screen). The safe choice is always the primary button.
function DeletionSteps({
  target,
  me,
  onCancel,
  onSubmit,
}: {
  target: Target;
  me: MyAccount;
  /** Leave step 1 ("Batal"). */
  onCancel: () => void;
  /** Sends the request; resolves to an error message, or null on success. */
  onSubmit: (target: Target) => Promise<string | null>;
}) {
  const { kind, name } = target;
  const [step, setStep] = useState<'explain' | 'confirm'>('explain');
  const [ack, setAck] = useState(false);
  const [ackError, setAckError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const heading = kind === 'child' ? t.explain.heading.child(name) : t.explain.heading[kind];
  const confirmTitle = kind === 'child' ? t.confirm.title.child(name) : t.confirm.title[kind];

  function next() {
    if (!ack) {
      setAckError(true);
      return;
    }
    setError(null);
    setStep('confirm');
  }

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const message = await onSubmit(target);
    // On success the screen shows the result (or, after an account deletion, the session ends).
    if (!alive.current) return;
    setBusy(false);
    setError(message);
  }

  return (
    <View className="gap-5" testID={`deletion-steps-${kind}`}>
      <Text variant="title" accessibilityRole="header">
        {heading}
      </Text>

      <Card className="gap-3">
        <Text variant="headline" accessibilityRole="header">
          {t.explain.deletedTitle}
        </Text>
        <Bullets items={deletedItems(kind, me)} icon="delete-outline" color={palette.danger} testID="deletion-deleted" />
      </Card>

      <Card className="gap-3">
        <Text variant="headline" accessibilityRole="header">
          {t.explain.keptTitle}
        </Text>
        <Bullets items={keptItems(me)} icon="info-outline" color={palette.primary} testID="deletion-kept" />
      </Card>

      <Card tone="cream" className="gap-3">
        <Text variant="headline" accessibilityRole="header">
          {t.explain.factsTitle}
        </Text>
        <Bullets items={facts(kind)} icon="schedule" color={palette.text} />
      </Card>

      {step === 'explain' ? (
        <View className="gap-3">
          <CheckboxField
            label={t.explain.acknowledge}
            checked={ack}
            onCheckedChange={(value) => {
              setAck(value);
              if (value) setAckError(false);
            }}
            error={ackError ? t.explain.acknowledgeError : null}
            testID="deletion-ack"
          />
          <Button title={t.explain.cancel} variant="primary" onPress={onCancel} testID="deletion-cancel" />
          <Button title={t.explain.next} variant="danger" onPress={next} testID="deletion-next" />
        </View>
      ) : (
        <View className="gap-3">
          {error ? <Banner tone="error" message={error} testID="deletion-error" /> : null}
          {/* Own wrapper: siblings of a view-is-modal panel are hidden from screen readers. */}
          <View>
            <ConfirmPanel
              title={confirmTitle}
              message={t.confirm.message}
              confirmLabel={kind === 'account' ? t.confirm.confirmAccount : t.confirm.confirmData}
              cancelLabel={t.confirm.cancel}
              busy={busy}
              testID="deletion-confirm"
              onCancel={() => {
                setStep('explain');
                setError(null);
              }}
              onConfirm={() => void confirm()}
            />
          </View>
        </View>
      )}
    </View>
  );
}

// Guardian: which child. Children whose deletion is pending cannot be picked again.
function ChildPicker({
  kids,
  rows,
  syncBlocked,
  onPick,
}: {
  kids: readonly ChildProfile[];
  rows: Readonly<Record<string, ChildSummary>>;
  syncBlocked: Readonly<Record<string, string>>;
  onPick: (childId: string) => void;
}) {
  const others = pendingElsewhere(
    Object.values(rows),
    kids.map((k) => k.id),
  );
  if (!kids.length) {
    return (
      <View className="gap-4">
        <EmptyState mascot="thinking" title={t.gate.noChildrenTitle} message={t.gate.noChildrenMessage} testID="deletion-no-children" />
        {others ? <Banner tone="warning" message={t.choose.pendingOthers(others)} testID="deletion-pending-others" /> : null}
      </View>
    );
  }
  return (
    <ListGroup title={t.choose.title} footer={others ? t.choose.pendingOthers(others) : t.choose.hint}>
      {kids.map((kid, index) => {
        const pending = isDeletionPending(kid.id, rows[kid.id], syncBlocked);
        return (
          <ListRow
            key={kid.id}
            icon="child-care"
            iconTone="sun"
            title={kidLabel(kid, index)}
            value={pending ? t.choose.pendingChip : undefined}
            disabled={pending}
            onPress={pending ? undefined : () => onPick(kid.id)}
            testID={`deletion-pick-${index}`}
          />
        );
      })}
    </ListGroup>
  );
}

/** The child-scope target: the teen's self profile, or the guardian's picked child. */
function childTarget(me: MyAccount, kids: readonly ChildProfile[], picked: string | null): Target | 'pick' | 'not_found' {
  const teen = me.accountType === 'teen';
  const childId = teen ? selfProfileId(me, kids) : picked;
  if (!childId) return teen ? 'not_found' : 'pick';
  const index = kids.findIndex((k) => k.id === childId);
  if (index < 0 && !teen) return 'not_found';
  const name = index >= 0 ? kidLabel(kids[index], index) : id.childAccounts.list.selfName;
  return { kind: teen ? 'self' : 'child', childId, name };
}

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/profile/settings');
}

// Deletion by a guardian (one child, or the whole account) or a teen (the self profile, or the
// whole account): ACCOUNTS_AND_FLOWS.md §1, §9. Route: /profile/delete?scope=child|account
// (&child=<id> skips the guardian's child picker). Child accounts are refused.
export function DeletionScreen() {
  const params = useLocalSearchParams<{ scope?: string; child?: string }>();
  const scope = params.scope === 'account' ? 'account' : 'child';
  const childParam = typeof params.child === 'string' && params.child ? params.child : null;
  const status = useSession((s) => s.status);
  const me = useMe();
  const localReady = useLocalReady();
  const kids = useLocalData((s) => s.kids);
  const syncBlocked = useLocalData((s) => s.syncBlocked);
  // list_children: the deletion_pending state of every child, also of those deleted on another phone.
  const summaries = useChildSummaries({ enabled: scope === 'child' && canRequestDeletion(me) });
  const [picked, setPicked] = useState<string | null>(childParam);
  // The target whose request is running: the child leaves the local store as soon as the
  // server accepts, so the screen keeps this copy instead of looking the child up again.
  const [frozen, setFrozen] = useState<Target | null>(null);
  const [done, setDone] = useState<{ kind: 'child' | 'self'; name: string; localOnly: boolean } | null>(null);

  async function submit(target: Target): Promise<string | null> {
    setFrozen(target);
    if (target.kind === 'account') {
      const res = await requestAccountDeletion();
      if (res.ok) return null; // signed out: the welcome screen shows the notice
      setFrozen(null);
      return deletionErrorMessage(res.code);
    }
    const res = await requestChildDeletion(target.childId);
    if (!res.ok) {
      setFrozen(null);
      return deletionErrorMessage(res.code);
    }
    setDone({ kind: target.kind, name: target.name, localOnly: res.requestId === null });
    return null;
  }

  let body: React.ReactNode;
  if (status !== 'signedIn') {
    body = <EmptyState mascot="thinking" title={t.gate.guestTitle} message={t.gate.guestMessage} testID="deletion-guest" />;
  } else if (!me || !localReady) {
    body = <Loading />;
  } else if (!canRequestDeletion(me)) {
    body = <EmptyState mascot="thinking" title={t.gate.childTitle} message={t.gate.childMessage} testID="deletion-not-allowed" />;
  } else if (done) {
    const message = done.localOnly ? t.done.localOnly(done.name) : done.kind === 'self' ? t.done.self : t.done.child(done.name);
    body = (
      <View className="gap-4" testID="deletion-done">
        <Banner tone="success" title={t.done.title} message={message} />
        <Button title={t.done.finish} onPress={leave} testID="deletion-finish" />
      </View>
    );
  } else {
    const account: Target = { kind: 'account', name: '' };
    const target = frozen ?? (scope === 'account' ? account : childTarget(me, kids, picked));
    if (target === 'pick') {
      body = <ChildPicker kids={kids} rows={summaries.rows} syncBlocked={syncBlocked} onPick={setPicked} />;
    } else if (target === 'not_found') {
      body = <EmptyState mascot="thinking" title={t.gate.notFound} testID="deletion-not-found" />;
    } else if (!frozen && target.kind !== 'account' && isDeletionPending(target.childId, summaries.rows[target.childId], syncBlocked)) {
      body = (
        <View className="gap-4" testID="deletion-pending">
          <Banner tone="warning" message={target.kind === 'self' ? t.pending.self : t.pending.child(target.name)} />
          <Button title={t.gate.back} variant="secondary" onPress={leave} />
        </View>
      );
    } else {
      const backToPicker = target.kind === 'child' && !childParam;
      body = (
        <DeletionSteps
          key={target.kind === 'account' ? 'account' : target.childId}
          target={target}
          me={me}
          onCancel={() => (backToPicker ? setPicked(null) : leave())}
          onSubmit={submit}
        />
      );
    }
  }

  return <Screen testID="deletion-screen">{body}</Screen>;
}
