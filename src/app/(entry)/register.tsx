import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { View, type TextInput } from 'react-native';

import { Banner } from '@/components/banner';
import { CheckboxField } from '@/components/checkbox-field';
import { HeroHeader } from '@/components/hero-header';
import { Mascot } from '@/components/mascot';
import { PasswordField } from '@/components/password-field';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { Turnstile } from '@/components/turnstile';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { signUp } from '@/core/auth/auth-service';
import { useCaptcha } from '@/core/auth/use-captcha';
import { checkPassword, isEmail, isPasswordValid } from '@/core/auth/validation';
import { isSupabaseConfigured } from '@/core/config';
import { id } from '@/core/i18n/id';

const t = id.auth;

type FieldErrors = { email?: string; password?: string; confirm?: string; privacy?: string };

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const captcha = useCaptcha('signup');
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const rules = useMemo(() => checkPassword(password), [password]);

  // An error goes away as soon as the person starts fixing that field.
  function clearError(field: keyof FieldErrors) {
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  }

  function validate() {
    const next: FieldErrors = {};
    if (!email.trim()) next.email = t.fieldErrors.emailRequired;
    else if (!isEmail(email)) next.email = t.fieldErrors.emailInvalid;
    if (!isPasswordValid(password)) next.password = t.fieldErrors.passwordRules;
    if (confirm !== password) next.confirm = t.fieldErrors.passwordMismatch;
    if (!agreed) next.privacy = t.fieldErrors.privacyRequired;
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit() {
    setFormError(null);
    if (!validate()) return;
    setBusy(true);
    const result = await signUp(email, password, await captcha.take());
    setBusy(false);
    captcha.reset(); // tokens are single-use
    if (!result.ok) setFormError(result.message);
    // Email confirmation is on (backend config): wait for the link. If the project ever
    // auto-confirms, a session exists and the route guard opens Home.
    else if (result.needsConfirmation) router.replace('/check-email');
  }

  return (
    <Screen flush>
      <HeroHeader>
        <View className="flex-row items-end justify-between">
          <View className="flex-1 gap-2 pr-2">
            <Text variant="display" accessibilityRole="header">
              {t.registerHeroTitle}
            </Text>
            <Text variant="body">{t.signUpIntro}</Text>
          </View>
          <Mascot size={88} mood="wow" />
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
              clearError('email');
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
              clearError('password');
            }}
            error={errors.password}
            rules={rules}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => confirmRef.current?.focus()}
          />
          <PasswordField
            ref={confirmRef}
            label={t.passwordConfirm}
            value={confirm}
            onChangeText={(v) => {
              setConfirm(v);
              clearError('confirm');
            }}
            error={errors.confirm}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="done"
          />
        </View>

        <View className="gap-2">
          <CheckboxField
            testID="privacy-agree"
            label={t.privacyAgree}
            checked={agreed}
            onCheckedChange={(v) => {
              setAgreed(v);
              if (v) clearError('privacy');
            }}
            error={errors.privacy}
          />
          <Button
            title={t.privacyRead}
            variant="ghost"
            icon="privacy-tip"
            onPress={() => router.push('/privacy')}
            className="self-start"
          />
        </View>

        {formError ? <Banner tone="error" message={formError} /> : null}

        <Turnstile key={captcha.widgetKey} status={captcha.status} onRetry={captcha.reset} {...captcha.widgetProps} />

        <View className="gap-3">
          <Button
            title={t.signUp}
            size="large"
            loading={busy}
            disabled={!isSupabaseConfigured}
            onPress={onSubmit}
            testID="register-submit"
          />
          <Button title={t.haveAccount} variant="ghost" onPress={() => router.replace('/login')} />
        </View>
      </View>
    </Screen>
  );
}
