import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { EmptyState } from '@/components/empty-state';
import { PasswordField } from '@/components/password-field';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { updatePassword } from '@/core/auth/auth-service';
import { useSession } from '@/core/auth/session-store';
import { checkPassword, isPasswordValid } from '@/core/auth/validation';
import { id } from '@/core/i18n/id';

const t = id.auth;

// Set a new password after a recovery link (the link created a fresh session).
export default function ResetPassword() {
  const status = useSession((s) => s.status);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const rules = useMemo(() => checkPassword(password), [password]);

  if (status !== 'signedIn') {
    return (
      <Screen>
        <EmptyState mascot="thinking" title={t.reset.title} message={t.reset.noSession} />
        <Button title={t.forgotPassword} variant="accent" onPress={() => router.replace('/auth/forgot-password')} />
      </Screen>
    );
  }

  async function onSubmit() {
    setFormError(null);
    const next: typeof errors = {};
    if (!isPasswordValid(password)) next.password = t.fieldErrors.passwordRules;
    if (confirm !== password) next.confirm = t.fieldErrors.passwordMismatch;
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    const result = await updatePassword(password);
    setBusy(false);
    if (result.ok) setDone(true);
    else setFormError(result.message);
  }

  if (done) {
    return (
      <Screen>
        <EmptyState mascot="happy" title={t.reset.done} />
        <Button title={t.callback.goHome} variant="accent" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text variant="body" tone="secondary">
        {t.reset.intro}
      </Text>
      <View className="gap-4">
        <PasswordField
          label={t.newPassword}
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
      {formError ? <Banner tone="error" message={formError} /> : null}
      <Button title={t.reset.submit} size="large" loading={busy} onPress={onSubmit} />
    </Screen>
  );
}
