import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Banner } from '@/components/banner';
import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useMe } from '@/core/account/account-store';
import { useSession } from '@/core/auth/session-store';
import { id } from '@/core/i18n/id';
import { palette } from '@/core/theme';
import { useLocalData, useLocalReady } from '@/data/local-store';

import { CreateAccountForm, type CreatedAccount } from './create-account-form';
import { CreatedCard } from './created-card';
import { ManageAccountPanel } from './manage-account-panel';
import { PrerequisiteStep } from './prerequisite-step';
import { childAccountErrorMessage, consentGiverFor, kidLabel } from './logic';
import { usePrerequisite } from './use-prerequisite';
import { useChildSummaries } from './use-child-summaries';

const t = id.childAccounts;

function Loading({ label }: { label: string }) {
  return (
    <View className="items-center gap-3 py-10" accessibilityLiveRegion="polite" testID="child-account-loading">
      <ActivityIndicator size="large" color={palette.primary} />
      <Text variant="body" tone="secondary">
        {label}
      </Text>
    </View>
  );
}

// Guardian manages the login of one child (ACCOUNTS_AND_FLOWS 2.2): check the child is on the
// server, create the account, then reset the password / disable / delete the login.
// Everything here talks to the child-accounts Edge Function through withSessionRetry; the
// backend may not be deployed yet, in which case the screen says "belum tersedia".
export function ChildAccountScreen() {
  const { id: childId } = useLocalSearchParams<{ id: string }>();
  const status = useSession((s) => s.status);
  const email = useSession((s) => s.email);
  const me = useMe();
  const localReady = useLocalReady();
  const kids = useLocalData((s) => s.kids);
  const blocked = useLocalData((s) => s.syncBlocked[childId]);
  const summaries = useChildSummaries();
  const prerequisite = usePrerequisite(childId, summaries);
  const [created, setCreated] = useState<CreatedAccount | null>(null);

  const reload = summaries.reload;
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const index = kids.findIndex((k) => k.id === childId);
  const kid = index >= 0 ? kids[index] : null;
  const row = summaries.rows[childId] ?? null;

  let body: React.ReactNode;
  if (status !== 'signedIn') {
    body = (
      <EmptyState
        mascot="thinking"
        title={t.screen.guestTitle}
        message={t.screen.guestMessage}
        testID="child-account-guest"
      />
    );
  } else if (!me || !localReady) {
    body = <Loading label={t.screen.loading} />;
  } else if (me.legacy || summaries.error === 'not_deployed') {
    body = (
      <EmptyState
        mascot="thinking"
        title={t.screen.unavailableTitle}
        message={t.screen.unavailableMessage}
        testID="child-account-unavailable"
      />
    );
  } else if (me.accountType !== 'guardian' || !me.capabilities.createChildAccounts) {
    body = (
      <EmptyState
        mascot="thinking"
        title={t.screen.notAllowedTitle}
        message={t.screen.notAllowedMessage}
        testID="child-account-not-allowed"
      />
    );
  } else if (!kid) {
    body = <EmptyState mascot="thinking" title={t.screen.notFound} testID="child-account-not-found" />;
  } else if (created) {
    body = (
      <CreatedCard
        parentEmail={email}
        username={created.username}
        videoConsent={created.videoConsent}
        onDone={() => {
          setCreated(null);
          void reload();
        }}
      />
    );
  } else if (!summaries.loaded && summaries.error) {
    // Without list_children we cannot tell whether the child already has an account.
    body = (
      <View className="gap-4" testID="child-account-load-failed">
        <EmptyState mascot="thinking" title={t.screen.loadFailedTitle} message={childAccountErrorMessage(summaries.error)} />
        {summaries.error === 'network' ? <Banner tone="warning" message={t.screen.offlineNote} /> : null}
        <Button title={t.screen.retry} icon="refresh" variant="secondary" loading={summaries.loading} onPress={() => void reload()} />
      </View>
    );
  } else if (!summaries.loaded && prerequisite.state !== 'ready') {
    // First load still running: avoid flashing the consent step for a child that is on the server.
    body = <Loading label={t.screen.loading} />;
  } else if (row?.deletionPending || blocked === 'deletion_pending') {
    body = <Banner tone="warning" message={t.screen.deletionPending} testID="child-account-deleting" />;
  } else if (row?.hasChildAccount) {
    body = (
      <ManageAccountPanel
        childId={childId}
        username={row.username}
        disabled={row.childAccountDisabled === true}
        showVideoLink={me.flags.brushingProofVideo}
        onChanged={() => void reload()}
      />
    );
  } else if (prerequisite.state !== 'ready') {
    body = <PrerequisiteStep childId={childId} giver={consentGiverFor(kid, me.accountType)} prerequisite={prerequisite} />;
  } else {
    body = (
      <CreateAccountForm
        childId={childId}
        showVideo={me.flags.brushingProofVideo}
        onCreated={(account) => {
          setCreated(account);
          void reload();
        }}
        onChildMissing={() => void prerequisite.recheck()}
        onAlreadyExists={() => void reload()}
      />
    );
  }

  return (
    <Screen testID="child-account-screen">
      <Stack.Screen options={{ title: t.title }} />
      {kid && status === 'signedIn' && !created ? (
        <Text variant="title" accessibilityRole="header">
          {t.screen.intro(kidLabel(kid, index))}
        </Text>
      ) : null}
      {body}
    </Screen>
  );
}
