import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { View, type TextInput } from 'react-native';

import { Banner } from '@/components/banner';
import { HeroHeader } from '@/components/hero-header';
import { Mascot } from '@/components/mascot';
import { PasswordField } from '@/components/password-field';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { Turnstile } from '@/components/turnstile';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { resendConfirmation, signIn } from '@/core/auth/auth-service';
import { useSession } from '@/core/auth/session-store';
import { useCaptcha } from '@/core/auth/use-captcha';
import { isEmail } from '@/core/auth/validation';
import { isSupabaseConfigured } from '@/core/config';
import { id } from '@/core/i18n/id';

const t = id.auth;

export default function Login() {
  const continueAsGuest = useSession((s) => s.continueAsGuest);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notConfirmed, setNotConfirmed] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const captcha = useCaptcha('login');
  const passwordRef = useRef<TextInput>(null);

  function validate() {
    const next: typeof errors = {};
    if (!email.trim()) next.email = t.fieldErrors.emailRequired;
    else if (!isEmail(email)) next.email = t.fieldErrors.emailInvalid;
    if (!password) next.password = t.fieldErrors.passwordRequired;
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit() {
    setFormError(null);
    setInfo(null);
    setNotConfirmed(false);
    if (!validate()) return;
    setBusy(true);
    const result = await signIn(email, password, await captcha.take());
    setBusy(false);
    captcha.reset(); // tokens are single-use
    if (!result.ok) {
      if (result.code === 'email_not_confirmed') setNotConfirmed(true);
      else setFormError(result.message);
    }
    // Success: the session store flips to signedIn and the route guard shows Home.
  }

  async function onResend() {
    setBusy(true);
    const result = await resendConfirmation(email, await captcha.take());
    setBusy(false);
    captcha.reset();
    if (result.ok) {
      setNotConfirmed(false);
      setInfo(t.checkEmail.resent);
    } else {
      setFormError(result.message);
    }
  }

  return (
    <Screen flush>
      <HeroHeader>
        <View className="flex-row items-end justify-between">
          <View className="flex-1 gap-2 pr-2">
            <Text variant="display" accessibilityRole="header">
              {t.loginHeroTitle}
            </Text>
            <Text variant="body">{t.loginHeroBody}</Text>
          </View>
          <Mascot size={96} mood="happy" />
        </View>
      </HeroHeader>

      <View className="gap-5 px-5">
        {!isSupabaseConfigured ? <Banner tone="info" message={t.notConfiguredBanner} /> : null}

        <View className="gap-4">
          <TextField
            label={t.email}
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              if (errors.email) setErrors((e) => ({ ...e, email: undefined }));
            }}
            error={errors.email}
            placeholder={t.emailPlaceholder}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <PasswordField
            ref={passwordRef}
            label={t.password}
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              if (errors.password) setErrors((e) => ({ ...e, password: undefined }));
            }}
            error={errors.password}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="done"
            onSubmitEditing={onSubmit}
          />
          <Button
            title={t.forgotPassword}
            variant="ghost"
            onPress={() => router.push('/auth/forgot-password')}
            className="self-end"
          />
        </View>

        {notConfirmed ? (
          <Banner
            tone="warning"
            title={t.notConfirmed.title}
            message={t.notConfirmed.body}
            action={<Button title={t.notConfirmed.action} variant="ghost" onPress={onResend} className="self-start" />}
          />
        ) : null}
        {formError ? <Banner tone="error" message={formError} /> : null}
        {info ? <Banner tone="success" message={info} /> : null}

        <Turnstile key={captcha.widgetKey} status={captcha.status} onRetry={captcha.reset} {...captcha.widgetProps} />

        <View className="gap-3">
          <Button
            title={t.signIn}
            size="large"
            loading={busy}
            disabled={!isSupabaseConfigured}
            onPress={onSubmit}
            testID="login-submit"
          />
          <Button title={t.signUp} variant="secondary" onPress={() => router.replace('/register')} />
          <Button title={t.useWithoutAccount} variant="ghost" onPress={() => continueAsGuest()} />
          <Text variant="caption" tone="secondary" className="text-center">
            {t.withoutAccountNote}
          </Text>
        </View>
      </View>
    </Screen>
  );
}
