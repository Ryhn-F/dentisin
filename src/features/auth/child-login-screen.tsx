import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
import { isValidChildUsername, normalizeChildUsername } from '@/core/account/api';
import { getRememberedParentEmail, signInChild } from '@/core/auth/auth-service';
import { useCaptcha } from '@/core/auth/use-captcha';
import { isEmail } from '@/core/auth/validation';
import { isSupabaseConfigured } from '@/core/config';
import { id } from '@/core/i18n/id';

import { useCountdown } from './child-login-countdown';
import { childLoginMessage, lockoutSeconds } from './child-login-errors';

const t = id.childLogin;

type Errors = { email?: string; username?: string; password?: string };

// Child login (ACCOUNTS_AND_FLOWS 2.3): parent email + username + password. On success the
// session store flips and the root router opens the child home; nothing to navigate here.
export function ChildLoginScreen() {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const captcha = useCaptcha('login');
  const lockout = useCountdown();
  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const emailTouched = useRef(false);

  // Prefill the remembered parent email unless the child already started typing.
  useEffect(() => {
    let active = true;
    getRememberedParentEmail().then((saved) => {
      if (active && saved && !emailTouched.current) setEmail(saved);
    });
    return () => {
      active = false;
    };
  }, []);

  const locked = lockout.left > 0;

  function validate() {
    const next: Errors = {};
    if (!email.trim()) next.email = t.fieldErrors.emailRequired;
    else if (!isEmail(email)) next.email = t.fieldErrors.emailInvalid;
    if (!username.trim()) next.username = t.fieldErrors.usernameRequired;
    else if (!isValidChildUsername(username)) next.username = t.fieldErrors.usernameInvalid;
    if (!password) next.password = t.fieldErrors.passwordRequired;
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit() {
    if (busy || locked) return;
    setFormError(null);
    if (!validate()) return;
    setBusy(true);
    const result = await signInChild({
      parentEmail: email.trim(),
      username: normalizeChildUsername(username),
      password,
      captchaToken: await captcha.take(),
    });
    setBusy(false);
    captcha.reset(); // tokens are single-use
    if (!result.ok) {
      if (result.code === 'too_many_attempts') lockout.start(lockoutSeconds(result.retryAfterS));
      // not_configured: the info banner above already explains it.
      setFormError(result.code === 'not_configured' ? null : childLoginMessage(result.code));
    }
  }

  return (
    <Screen flush>
      <HeroHeader>
        <View className="flex-row items-end justify-between">
          <View className="flex-1 gap-2 pr-2">
            <Text variant="display" accessibilityRole="header">
              {t.heroTitle}
            </Text>
            <Text variant="body">{t.heroBody}</Text>
          </View>
          <Mascot size={96} mood="happy" />
        </View>
      </HeroHeader>

      <View className="gap-5 px-5">
        {!isSupabaseConfigured ? <Banner tone="info" message={id.auth.notConfiguredBanner} /> : null}

        <View className="gap-4">
          <TextField
            label={t.parentEmail}
            helper={t.parentEmailHelper}
            value={email}
            onChangeText={(v) => {
              emailTouched.current = true;
              setEmail(v);
              if (errors.email) setErrors((e) => ({ ...e, email: undefined }));
            }}
            error={errors.email}
            placeholder={id.auth.emailPlaceholder}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => usernameRef.current?.focus()}
            testID="child-login-email"
          />
          <TextField
            ref={usernameRef}
            label={t.username}
            helper={t.usernameHelper}
            value={username}
            onChangeText={(v) => {
              setUsername(v);
              if (errors.username) setErrors((e) => ({ ...e, username: undefined }));
            }}
            error={errors.username}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
            testID="child-login-username"
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
            testID="child-login-password"
          />
        </View>

        {formError ? <Banner tone="error" message={formError} /> : null}

        <Turnstile key={captcha.widgetKey} status={captcha.status} onRetry={captcha.reset} {...captcha.widgetProps} />

        <View className="gap-3">
          <Button
            title={locked ? t.submitWait(lockout.left) : t.submit}
            size="large"
            loading={busy}
            disabled={!isSupabaseConfigured || locked}
            onPress={onSubmit}
            testID="child-login-submit"
          />
          <Text variant="caption" tone="secondary" className="text-center">
            {t.forgotHint}
          </Text>
          <Button title={t.backToLogin} variant="ghost" onPress={() => router.replace('/login')} testID="child-login-back" />
        </View>
      </View>
    </Screen>
  );
}
