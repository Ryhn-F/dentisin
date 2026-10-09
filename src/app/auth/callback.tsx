import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { Mascot } from '@/components/mascot';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { completeAuthCallback } from '@/core/auth/auth-service';
import { parseAuthCallback, type AuthCallback } from '@/core/auth/callback-url';
import { useSession } from '@/core/auth/session-store';
import { id } from '@/core/i18n/id';
import { palette } from '@/core/theme';

const t = id.auth.callback;
const URL_WAIT_MS = 1500;

// Target of dentisai://auth/callback (email confirmation and password recovery).
// Reached via the static page app.ryhnfir.dev/auth/callback (backend README TODO).
export default function AuthCallbackScreen() {
  const url = Linking.useURL();
  const params = useLocalSearchParams<Record<string, string>>();
  const status = useSession((s) => s.status);
  const handled = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (handled.current) return;

    // Full URL keeps the #fragment (implicit flow); router params only see the query.
    let parsed: AuthCallback = parseAuthCallback(url);
    if (parsed.kind === 'empty') {
      const query = new URLSearchParams(
        Object.entries(params).filter((e): e is [string, string] => typeof e[1] === 'string'),
      ).toString();
      parsed = parseAuthCallback(query ? `callback?${query}` : null);
    }

    const run = (callback: AuthCallback) => {
      handled.current = true;
      completeAuthCallback(callback).then((result) => {
        if (!result.ok) {
          setError(result.message);
          return;
        }
        if (result.type === 'recovery' || useSession.getState().recovering) {
          router.replace('/auth/reset-password');
        } else {
          router.replace('/');
        }
      });
    };

    if (parsed.kind !== 'empty') {
      run(parsed);
      return;
    }
    // The opening URL can arrive a moment after mount.
    const timer = setTimeout(() => run(parsed), URL_WAIT_MS);
    return () => clearTimeout(timer);
  }, [url, params]);

  if (error) {
    return (
      <Screen>
        <EmptyState mascot="thinking" title={t.failedTitle} message={error} />
        {status === 'signedIn' || status === 'guest' ? (
          <Button title={t.goHome} variant="accent" onPress={() => router.replace('/')} />
        ) : (
          <Button title={t.goToSignIn} variant="accent" onPress={() => router.replace('/login')} />
        )}
      </Screen>
    );
  }

  return (
    <View className="flex-1 items-center justify-center gap-4 bg-bg">
      <Mascot size={120} mood="thinking" />
      <ActivityIndicator color={palette.primary} size="large" />
      <Text variant="body" tone="secondary">
        {t.working}
      </Text>
    </View>
  );
}
