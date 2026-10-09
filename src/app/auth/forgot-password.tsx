import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { Mascot } from '@/components/mascot';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { Turnstile } from '@/components/turnstile';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { requestPasswordReset } from '@/core/auth/auth-service';
import { useSession } from '@/core/auth/session-store';
import { isEmail } from '@/core/auth/validation';
import { config, isSupabaseConfigured } from '@/core/config';
import { id } from '@/core/i18n/id';

const t = id.auth;
const captchaRequired = Boolean(config.turnstileSiteKey) && process.env.EXPO_OS !== 'web';

// Used from Login ("Lupa kata sandi?") and from Account settings ("Ubah kata sandi").
// backend config.toml has secure_password_change = true, so in-app changes go through
// an email link (recent sign-in), not a direct update.
export default function ForgotPassword() {
  const sessionEmail = useSession((s) => s.email);
  const signedIn = useSession((s) => s.status === 'signedIn');
  const [email, setEmail] = useState(sessionEmail ?? '');
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);

  async function onSubmit() {
    setFormError(null);
    if (!email.trim()) return setError(t.fieldErrors.emailRequired);
    if (!isEmail(email)) return setError(t.fieldErrors.emailInvalid);
    setError(null);
    if (captchaRequired && !captcha) return setFormError(t.fieldErrors.captchaRequired);
    setBusy(true);
    const result = await requestPasswordReset(email, captcha ?? undefined);
    setBusy(false);
    setCaptcha(null);
    setCaptchaKey((k) => k + 1);
    // Same message whether or not the email exists (no account enumeration).
    if (result.ok) setSent(true);
    else setFormError(result.message);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: signedIn ? t.forgot.changeTitle : t.forgot.title }} />
      {!isSupabaseConfigured ? <Banner tone="info" message={t.notConfiguredBanner} /> : null}
      <View className="flex-row items-center gap-4">
        <Mascot size={80} mood="thinking" />
        <Text variant="body" tone="secondary" className="flex-1">
          {signedIn ? t.forgot.changeIntro : t.forgot.intro}
        </Text>
      </View>
      <TextField
        label={t.email}
        value={email}
        onChangeText={setEmail}
        error={error}
        placeholder={t.emailPlaceholder}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        editable={!signedIn}
      />
      {sent ? <Banner tone="success" message={t.forgot.sent} /> : null}
      {formError ? <Banner tone="error" message={formError} /> : null}
      <Turnstile key={captchaKey} onToken={setCaptcha} />
      <Button title={t.forgot.submit} size="large" loading={busy} disabled={!isSupabaseConfigured} onPress={onSubmit} />
    </Screen>
  );
}
