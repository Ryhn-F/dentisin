import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, View, type TextInput } from 'react-native';

import { Banner } from '@/components/banner';
import { CheckboxField } from '@/components/checkbox-field';
import { HeroHeader } from '@/components/hero-header';
import { IconTile } from '@/components/icon-tile';
import { Mascot } from '@/components/mascot';
import { PasswordField } from '@/components/password-field';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { Turnstile } from '@/components/turnstile';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { clearPendingTeenBirth, setPendingTeenBirth, signUp } from '@/core/auth/auth-service';
import { useCaptcha } from '@/core/auth/use-captcha';
import { checkPassword, isEmail, isPasswordValid } from '@/core/auth/validation';
import { isSupabaseConfigured } from '@/core/config';
import { id } from '@/core/i18n/id';

import { DEFAULT_AGE_BOUNDS, evaluateTeenAge } from './register-age';
import { AgeGateNotice, BirthPicker } from './register-birth-picker';
import { RoleStep, type RegisterKind } from './register-role-step';

const t = id.auth;
const r = id.registerFlow;

type Phase = 'role' | 'birth' | 'form';
type FieldErrors = { email?: string; password?: string; confirm?: string; privacy?: string };

function birthLabel(year: number, month: number | null): string {
  return month ? `${id.monthsLong[month - 1]} ${year}` : String(year);
}

// Sign-up in two steps (ACCOUNTS_AND_FLOWS.md §2.1): who uses DentisAI (a teen first gives birth
// year and month, checked before any account exists), then the email / password form. The account
// type is only a sign-up choice; the app reads the real type from my_account() afterwards.
export function RegisterScreen({ now }: { /** Injected in tests; defaults to the current date. */ now?: Date }) {
  const [phase, setPhase] = useState<Phase>('role');
  const [kind, setKind] = useState<RegisterKind | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);

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
  const gate = useMemo(
    () => (year === null ? null : evaluateTeenAge(year, month, now, DEFAULT_AGE_BOUNDS)),
    [year, month, now],
  );
  const birthOk = gate?.status === 'ok';

  // Hardware back walks the steps back before it leaves the screen.
  useEffect(() => {
    if (phase === 'role') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setPhase(phase === 'form' && kind === 'teen' ? 'birth' : 'role');
      return true;
    });
    return () => sub.remove();
  }, [phase, kind]);

  function choose(next: RegisterKind) {
    setKind(next);
    setFormError(null);
    setPhase(next === 'teen' ? 'birth' : 'form');
  }

  // The "too young / too old" notice leads to the guardian route with one tap.
  function switchToGuardian() {
    choose('guardian');
  }

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
    if (!kind) return setPhase('role');
    if (kind === 'teen' && (year === null || !birthOk)) return setPhase('birth');
    if (!validate()) return;
    setBusy(true);
    // The teen's birth stays on this device until the setup screen sends it to the server. It is
    // stored BEFORE sign-up: if the project auto-confirms, the router opens the setup screen as
    // soon as the session exists. A guardian sign-up drops any earlier teen attempt.
    if (kind === 'teen' && year !== null) await setPendingTeenBirth({ year, month });
    else await clearPendingTeenBirth();
    const result = await signUp(email, password, kind, await captcha.take());
    setBusy(false);
    captcha.reset(); // tokens are single-use
    if (!result.ok) setFormError(result.message);
    // Email confirmation is on (backend config): wait for the link. If the project ever
    // auto-confirms, a session exists and the route guard opens the next screen.
    else if (result.needsConfirmation) router.replace('/check-email');
  }

  const heroTitle =
    phase === 'role' ? r.role.heroTitle : phase === 'birth' ? r.birth.heroTitle : kind === 'teen' ? r.form.heroTitleTeen : t.registerHeroTitle;
  const heroBody =
    phase === 'role'
      ? r.role.heroBody
      : phase === 'birth'
        ? r.birth.heroBody(DEFAULT_AGE_BOUNDS.min, DEFAULT_AGE_BOUNDS.max)
        : t.signUpIntro;

  return (
    <Screen flush>
      <HeroHeader>
        <View className="flex-row items-end justify-between">
          <View className="flex-1 gap-2 pr-2">
            <Text variant="display" accessibilityRole="header">
              {heroTitle}
            </Text>
            <Text variant="body">{heroBody}</Text>
          </View>
          <Mascot size={88} mood="wow" />
        </View>
      </HeroHeader>

      <View className="gap-5 px-5">
        {!isSupabaseConfigured ? <Banner tone="info" message={t.notConfiguredBanner} /> : null}

        {phase === 'role' ? (
          <>
            <RoleStep onChoose={choose} />
            <Button title={t.haveAccount} variant="ghost" onPress={() => router.replace('/login')} />
          </>
        ) : null}

        {phase === 'birth' ? (
          <>
            <BirthPicker year={year} month={month} onYearChange={setYear} onMonthChange={setMonth} now={now} />
            {gate ? (
              <AgeGateNotice
                gate={gate}
                bounds={DEFAULT_AGE_BOUNDS}
                action={{ label: r.gate.useGuardian, onPress: switchToGuardian }}
              />
            ) : null}
            <View className="gap-3">
              <Button
                title={r.birth.continue}
                size="large"
                disabled={!birthOk}
                accessibilityHint={year === null ? r.birth.yearRequired : undefined}
                onPress={() => setPhase('form')}
                testID="register-birth-continue"
              />
              <Button title={r.form.change} variant="ghost" onPress={() => setPhase('role')} testID="register-birth-back" />
            </View>
          </>
        ) : null}

        {phase === 'form' ? (
          <>
            <View
              testID="register-type-header"
              className="flex-row items-center gap-3 rounded-tile bg-tint-lavender p-3"
              style={{ borderCurve: 'continuous' }}
            >
              <IconTile name={kind === 'teen' ? 'face' : 'family-restroom'} tone={kind === 'teen' ? 'sun' : 'blue'} size={44} />
              <View className="flex-1">
                <Text variant="bodyStrong">{kind === 'teen' ? r.form.typeTeen : r.form.typeGuardian}</Text>
                {kind === 'teen' && year !== null ? (
                  <Text variant="caption" tone="secondary">
                    {r.form.born(birthLabel(year, month))}
                  </Text>
                ) : null}
              </View>
              <Button
                title={r.form.change}
                variant="ghost"
                onPress={() => setPhase('role')}
                accessibilityHint={r.form.changeLabel}
                testID="register-change-type"
              />
            </View>

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
          </>
        ) : null}
      </View>
    </Screen>
  );
}
