import { router } from 'expo-router';

import { ListGroup, ListRow } from '@/components/list-group';
import { Screen } from '@/components/screen';
import { useLimits, useMe } from '@/core/account/account-store';
import { useSession } from '@/core/auth/session-store';
import { id } from '@/core/i18n/id';
import { useSyncStatus } from '@/core/sync/use-sync-status';
import { brushingWindows } from '@/domain/brushing-windows';
import { canRequestDeletion } from '@/features/deletion/deletion-flow';

const t = id.settings;
const syncLabels = { ...id.components.sync, attention: id.syncV2.status.attention };

export default function Settings() {
  const status = useSession((s) => s.status);
  const email = useSession((s) => s.email);
  const signOut = useSession((s) => s.signOut);
  const leaveGuest = useSession((s) => s.leaveGuest);
  const guest = status === 'guest';
  const me = useMe();
  const teen = me?.accountType === 'teen';
  const canDelete = canRequestDeletion(me);
  const w = brushingWindows;
  const sync = useSyncStatus();
  // The streak counts a day with one session of at least streak_min_duration_s (server rule).
  const streakMinutes = Math.max(1, Math.round(useLimits().streakMinDurationS / 60));

  return (
    <Screen>
      <ListGroup title={t.accountTitle} footer={guest ? undefined : t.signOutHint}>
        {guest ? (
          <ListRow icon="login" iconTone="blue" title={t.signInRow} onPress={() => leaveGuest()} />
        ) : (
          [
            <ListRow key="email" icon="mail-outline" title={t.email} value={email ?? ''} />,
            <ListRow
              key="password"
              icon="lock-outline"
              iconTone="sun"
              title={t.changePassword}
              onPress={() => router.push('/auth/forgot-password')}
            />,
            // Signing out is reversible and keeps local data, so no confirmation dialog.
            <ListRow key="signout" icon="logout" iconTone="coral" title={t.signOut} onPress={() => signOut()} testID="sign-out" />,
          ]
        )}
      </ListGroup>

      {/* Editable in phase 6; shown read-only so the active rules are visible. */}
      <ListGroup title={t.remindersTitle}>
        <ListRow icon="wb-sunny" iconTone="sun" title={t.morningWindow} value={`${w.morning.start}–${w.morning.end}`} />
        <ListRow icon="nightlight-round" iconTone="blue" title={t.eveningWindow} value={`${w.evening.start}–${w.evening.end}`} />
        <ListRow icon="public" title={t.timezone} value={t.timezoneValue} />
        <ListRow icon="local-fire-department" iconTone="coral" title={t.streakRule} value={t.streakRuleValue(streakMinutes)} />
      </ListGroup>

      <ListGroup title={t.privacyTitle}>
        <ListRow icon="verified-user" iconTone="mint" title={t.consents} onPress={() => router.push('/profile/consents')} />
        <ListRow
          icon="sync"
          title={t.sync}
          value={guest ? t.syncLocal : syncLabels[sync]}
          onPress={() => router.push('/profile/sync')}
          testID="settings-sync"
        />
        <ListRow icon="privacy-tip" title={t.privacyNotice} onPress={() => router.push('/privacy')} />
      </ListGroup>

      {/* request_deletion(): guardians and teens only (ACCOUNTS_AND_FLOWS.md §1); no-account mode keeps everything on the phone. */}
      {guest ? (
        <ListGroup title={t.deleteTitle}>
          <ListRow icon="person-remove" title={t.deleteChild} value={id.common.soon} destructive disabled />
        </ListGroup>
      ) : canDelete ? (
        <ListGroup title={t.deleteTitle} footer={id.deletion.settings.footer}>
          <ListRow
            icon="person-remove"
            title={teen ? id.deletion.settings.selfRow : t.deleteChild}
            destructive
            onPress={() => router.push({ pathname: '/profile/delete', params: { scope: 'child' } })}
            testID="settings-delete-child"
          />
          <ListRow
            icon="delete-forever"
            title={t.deleteAccount}
            destructive
            onPress={() => router.push({ pathname: '/profile/delete', params: { scope: 'account' } })}
            testID="settings-delete-account"
          />
        </ListGroup>
      ) : null}

      <ListGroup title={t.aboutTitle}>
        <ListRow icon="info-outline" iconTone="coral" title={t.about} onPress={() => router.push('/profile/about')} />
      </ListGroup>
    </Screen>
  );
}
