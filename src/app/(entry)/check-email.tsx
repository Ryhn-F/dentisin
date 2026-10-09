import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { Turnstile } from '@/components/turnstile';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { resendConfirmation } from '@/core/auth/auth-service';
import { useSession } from '@/core/auth/session-store';
import { config } from '@/core/config';
import { id } from '@/core/i18n/id';

const t = id.auth.checkEmail;
const RESEND_COOLDOWN_S = 60; // backend: auth.email max_frequency = "60s"
const captchaRequired = Boolean(config.turnstileSiteKey) && process.env.EXPO_OS !== 'web';

export default function CheckEmail() {
  const email = useSession((s) => s.pendingEmail);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function onResend() {
    if (!email) return;
    if (captchaRequired && !captcha) {
      setMessage({ tone: 'error', text: id.auth.fieldErrors.captchaRequired });
      return;
    }
    setBusy(true);
    const result = await resendConfirmation(email, captcha ?? undefined);
    setBusy(false);
    setCaptcha(null);
    setCaptchaKey((k) => k + 1);
    setMessage(result.ok ? { tone: 'success', text: t.resent } : { tone: 'error', text: result.message });
    if (result.ok) setCooldown(RESEND_COOLDOWN_S);
  }

  return (
    <Screen>
      <EmptyState mascot="wow" title={t.title} message={email ? t.body(email) : t.bodyNoEmail} />
      <Text variant="caption" tone="secondary" className="text-center">
        {t.spamHint}
      </Text>
      {message ? <Banner tone={message.tone} message={message.text} /> : null}
      {email ? <Turnstile key={captchaKey} onToken={setCaptcha} /> : null}
      <View className="gap-3">
        {email ? (
          <Button
            title={cooldown > 0 ? t.resendIn(cooldown) : t.resend}
            variant="secondary"
            disabled={cooldown > 0}
            loading={busy}
            onPress={onResend}
          />
        ) : null}
        <Button title={t.backToSignIn} variant="ghost" onPress={() => router.replace('/login')} />
      </View>
    </Screen>
  );
}
