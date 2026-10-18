import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useAccount } from '@/core/account/account-store';
import type { ApiErrorCode } from '@/core/account/api';
import { useSession } from '@/core/auth/session-store';
import { id } from '@/core/i18n/id';
import { palette } from '@/core/theme';

const t = id.accountGate;

function errorMessage(code: ApiErrorCode | null): string {
  if (code === 'network') return t.errors.network;
  if (code === 'not_authenticated' || code === 'unauthorized' || code === 'forbidden') return t.errors.sessionExpired;
  if (code === 'not_configured') return t.errors.notConfigured;
  return t.errors.unknown;
}

// Signed in, but the account type is not known yet (first sign-in on this phone while
// my_account() loads, or it failed with nothing cached). Routing waits here: guessing the
// account type could show a child the parent app. Once the account arrives the root layout's
// guards move on by themselves.
export default function AccountGate() {
  const status = useAccount((s) => s.status);
  const lastError = useAccount((s) => s.lastError);
  const refresh = useAccount((s) => s.refresh);
  const signOut = useSession((s) => s.signOut);
  const loading = status === 'idle' || status === 'loading';

  useEffect(() => {
    if (useAccount.getState().status === 'idle') void refresh();
  }, [refresh]);

  if (loading) {
    return (
      <Screen>
        <View className="items-center gap-4 py-10" accessibilityLiveRegion="polite" testID="account-gate-loading">
          <ActivityIndicator size="large" color={palette.primary} accessibilityLabel={t.loadingBody} />
          <Text variant="title" className="text-center">
            {t.loadingTitle}
          </Text>
          <Text variant="body" tone="secondary" className="text-center">
            {t.loadingBody}
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <EmptyState mascot="thinking" title={t.errorTitle} message={errorMessage(lastError)} testID="account-gate-error" />
      <Text variant="caption" tone="secondary" className="text-center">
        {t.keepData}
      </Text>
      <View className="gap-3">
        <Button title={t.retry} icon="refresh" onPress={() => void refresh()} testID="account-gate-retry" />
        <Button title={t.signOut} variant="ghost" icon="logout" onPress={() => void signOut()} testID="account-gate-sign-out" />
      </View>
    </Screen>
  );
}
