import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Banner } from '@/components/banner';
import { HeroHeader } from '@/components/hero-header';
import { PasswordField } from '@/components/password-field';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { Turnstile } from '@/components/turnstile';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Text } from '@/components/ui/text';
import { signUp } from '@/core/auth/auth-service';
import { checkPassword, isEmail, isPasswordValid } from '@/core/auth/validation';
import { config, isSupabaseConfigured } from '@/core/config';
import { id } from '@/core/i18n/id';
import { shadows } from '@/core/theme';

const t = id.auth;
const captchaRequired = Boolean(config.turnstileSiteKey) && process.env.EXPO_OS !== 'web';

type FieldErrors = { email?: string; password?: string; confirm?: string; privacy?: string };

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);

  const rules = useMemo(() => checkPassword(password), [password]);

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
    if (captchaRequired && !captcha) {
      setFormError(t.fieldErrors.captchaRequired);
      return;
    }
    setBusy(true);
    const result = await signUp(email, password, captcha ?? undefined);
    setBusy(false);
    setCaptcha(null);
    setCaptchaKey((k) => k + 1);
    if (result.ok) router.replace('/check-email');
    else setFormError(result.message);
  }

  return (
    <Screen flush>
      <HeroHeader>
        <Text variant="display" accessibilityRole="header">
          {t.registerHeroTitle}
        </Text>
        <Text variant="body">{t.signUpIntro}</Text>
      </HeroHeader>

      <View className="gap-5 px-5">
        {!isSupabaseConfigured ? <Banner tone="info" message={t.notConfiguredBanner} /> : null}

        <View className="gap-4">
          <TextField
            label={t.email}
            value={email}
            onChangeText={setEmail}
            error={errors.email}
            placeholder={t.emailPlaceholder}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
          />
          <PasswordField
            label={t.password}
            value={password}
            onChangeText={setPassword}
            error={errors.password}
            rules={rules}
            autoComplete="new-password"
            textContentType="newPassword"
          />
          <PasswordField
            label={t.passwordConfirm}
            value={confirm}
            onChangeText={setConfirm}
            error={errors.confirm}
            autoComplete="new-password"
            textContentType="newPassword"
          />
        </View>

        <View className="gap-3 rounded-card bg-card p-4" style={{ boxShadow: shadows.card }}>
          <View className="flex-row items-center gap-3">
            <Checkbox checked={agreed} onCheckedChange={setAgreed} accessibilityLabel={t.privacyAgree} />
            <Pressable className="flex-1" onPress={() => setAgreed((v) => !v)} accessibilityElementsHidden>
              <Text variant="bodyStrong">{t.privacyAgree}</Text>
            </Pressable>
          </View>
          <Button
            title={t.privacyRead}
            variant="ghost"
            icon="privacy-tip"
            onPress={() => router.push('/privacy')}
            className="self-start"
          />
          {errors.privacy ? (
            <Text variant="caption" tone="danger">
              {errors.privacy}
            </Text>
          ) : null}
        </View>

        {formError ? <Banner tone="error" message={formError} /> : null}

        <Turnstile key={captchaKey} onToken={setCaptcha} />

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
