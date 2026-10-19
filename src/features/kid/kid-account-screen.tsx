import { useState } from 'react';
import { View } from 'react-native';

import { Card } from '@/components/card';
import { IconTile } from '@/components/icon-tile';
import { Mascot } from '@/components/mascot';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useMe } from '@/core/account/account-store';
import { useSession } from '@/core/auth/session-store';
import { id } from '@/core/i18n/id';

import { kidAccountView } from './kid-home-logic';

const t = id.kid.account;

// "Akun" tab of a child account (/kid/account): the username, how to get a new password
// (ask the parent: children cannot reset it themselves), and sign-out after a confirmation.
// Nothing else: no settings, no deletion (ACCOUNTS_AND_FLOWS.md §1, §10).
export function KidAccountScreen() {
  const me = useMe();
  const signOut = useSession((s) => s.signOut);
  const kid = kidAccountView(me);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSignOut() {
    setBusy(true);
    try {
      // Foundation sign-out: clears the Supabase session, the account cache and the router
      // goes back to the entry screens.
      await signOut();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen testID="kid-account">
      <View className="items-center gap-2">
        <Mascot size={96} mood="happy" />
      </View>

      <Card className="flex-row items-center gap-4" testID="kid-account-username">
        <IconTile name="person" tone="blue" size={52} round />
        <View className="flex-1 gap-0.5">
          <Text variant="caption" tone="secondary">
            {t.usernameLabel}
          </Text>
          <Text variant="headline" selectable>
            {kid?.username ?? ''}
          </Text>
        </View>
      </Card>

      <Card tone="cream" className="flex-row items-center gap-4" testID="kid-account-forgot">
        <IconTile name="lock-outline" tone="sun" size={52} round />
        <View className="flex-1 gap-1">
          <Text variant="headline">{t.forgotTitle}</Text>
          <Text variant="body">{t.forgotBody}</Text>
        </View>
      </Card>

      {confirming ? (
        <Card tone="peach" className="gap-4" testID="kid-signout-confirm">
          <View className="gap-1" accessible accessibilityRole="alert">
            <Text variant="headline">{t.confirmTitle}</Text>
            <Text variant="body">{t.confirmBody}</Text>
          </View>
          <Button
            testID="kid-signout-yes"
            title={t.confirmYes}
            icon="logout"
            variant="danger"
            size="large"
            loading={busy}
            onPress={() => void onSignOut()}
          />
          <Button
            testID="kid-signout-no"
            title={t.confirmNo}
            variant="inverse"
            size="large"
            disabled={busy}
            onPress={() => setConfirming(false)}
          />
        </Card>
      ) : (
        <Button
          testID="kid-signout"
          title={id.kid.signOut}
          icon="logout"
          variant="secondary"
          size="large"
          onPress={() => setConfirming(true)}
        />
      )}
    </Screen>
  );
}
