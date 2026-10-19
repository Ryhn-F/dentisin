import { useRef, useState } from 'react';
import { View, type TextInput } from 'react-native';

import { Banner } from '@/components/banner';
import { ConsentCard } from '@/components/consent-card';
import { PasswordField } from '@/components/password-field';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { childAccounts, normalizeChildUsername, type ApiErrorCode } from '@/core/account/api';
import { id } from '@/core/i18n/id';
import { useLocalData } from '@/data/local-store';

import {
  childAccountErrorMessage,
  consentCopyFor,
  consentTextVersionFor,
  passwordRuleViews,
  validateCreateForm,
  type CreateFormErrors,
} from './logic';
import { withSessionRetry } from './session-retry';

const t = id.childAccounts.create;
// The full (d) text: the recorded text_version (consentTextVersionFor('guardian', 'd')) must be
// the text the guardian saw, including where it is stored, retention and the right to withdraw.
const dCopy = consentCopyFor('guardian', 'd');

export type CreatedAccount = { username: string; videoConsent: boolean };

// Step 2: username + password for the child's login. The password lives only in this
// component's state and is cleared as soon as the account exists; it is never stored or logged.
export function CreateAccountForm({
  childId,
  showVideo,
  onCreated,
  onChildMissing,
  onAlreadyExists,
}: {
  childId: string;
  /** me.flags.brushing_proof_video: offer consent (d). */
  showVideo: boolean;
  onCreated: (account: CreatedAccount) => void;
  /** Server said child_not_found: re-check the sync state. */
  onChildMissing: () => void;
  /** Server said child_already_has_account: reload the account status. */
  onAlreadyExists: () => void;
}) {
  const setConsent = useLocalData((s) => s.setConsent);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [video, setVideo] = useState(false);
  const [touched, setTouched] = useState({ username: false, password: false, confirm: false });
  const [serverField, setServerField] = useState<{ username?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const check = validateCreateForm({ username, password, confirm });
  const shown: Partial<CreateFormErrors> = {
    username: touched.username ? (serverField.username ?? check.errors.username) : serverField.username ?? null,
    password: touched.password ? (serverField.password ?? check.errors.password) : serverField.password ?? null,
    confirm: touched.confirm ? check.errors.confirm : null,
  };

  async function submit() {
    setTouched({ username: true, password: true, confirm: true });
    setFormError(null);
    setServerField({});
    if (!check.ok || busy) return;
    setBusy(true);
    const res = await withSessionRetry(() => childAccounts.create({ childId, username: check.username, password }));
    setBusy(false);
    if (res.ok) {
      // Consent (d) is granted by the guardian after the account exists, so a failed create
      // never leaves a video consent behind.
      if (showVideo && video) {
        setConsent(childId, 'd', true, { textVersion: consentTextVersionFor('guardian', 'd') });
      }
      setPassword('');
      setConfirm('');
      onCreated({ username: res.data.username, videoConsent: showVideo && video });
      return;
    }
    handleError(res.code);
  }

  function handleError(code: ApiErrorCode) {
    const message = childAccountErrorMessage(code);
    if (code === 'username_taken' || code === 'invalid_username') setServerField({ username: message });
    else if (code === 'weak_password') setServerField({ password: message });
    else setFormError(message);
    if (code === 'child_not_found') onChildMissing();
    if (code === 'child_already_has_account') onAlreadyExists();
  }

  return (
    <View className="gap-5" testID="create-account-form">
      <Text variant="body" tone="secondary">
        {t.intro}
      </Text>

      <Banner tone="warning" title={t.nameWarningTitle} message={t.nameWarning} testID="name-warning" />

      <View className="gap-3">
        <TextField
          testID="create-username"
          label={t.username}
          helper={t.usernameHelper}
          error={shown.username}
          value={username}
          onChangeText={(v) => {
            setUsername(v);
            if (serverField.username) setServerField((e) => ({ ...e, username: undefined }));
          }}
          onBlur={() => {
            setUsername((v) => normalizeChildUsername(v));
            setTouched((x) => ({ ...x, username: true }));
          }}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={30}
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <View className="gap-1 rounded-tile bg-tint-sky p-4" accessibilityRole="list" accessibilityLabel={t.usernameRulesTitle}>
          <Text variant="label">{t.usernameRulesTitle}</Text>
          {t.usernameRules.map((rule) => (
            <Text key={rule} variant="caption">
              {`• ${rule}`}
            </Text>
          ))}
        </View>
      </View>

      <View className="gap-3">
        <PasswordField
          testID="create-password"
          ref={passwordRef}
          label={t.password}
          error={shown.password}
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            if (serverField.password) setServerField((e) => ({ ...e, password: undefined }));
          }}
          onBlur={() => setTouched((x) => ({ ...x, password: true }))}
          rules={passwordRuleViews(password)}
          textContentType="newPassword"
          returnKeyType="next"
          onSubmitEditing={() => confirmRef.current?.focus()}
        />
        <Text variant="caption" tone="secondary">
          {t.passwordTip}
        </Text>
        <PasswordField
          testID="create-confirm"
          ref={confirmRef}
          label={t.confirm}
          error={shown.confirm}
          value={confirm}
          onChangeText={setConfirm}
          onBlur={() => setTouched((x) => ({ ...x, confirm: true }))}
          textContentType="newPassword"
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
        />
      </View>

      {showVideo ? (
        <ConsentCard testID="create-video" icon="videocam" copy={dCopy} value={video} onValueChange={setVideo} note={t.videoHint} />
      ) : null}

      {formError ? <Banner tone="error" message={formError} testID="create-error" /> : null}

      <Button
        testID="create-submit"
        title={busy ? t.submitting : t.submit}
        variant="accent"
        size="large"
        icon="person-add"
        loading={busy}
        onPress={() => void submit()}
      />
    </View>
  );
}
