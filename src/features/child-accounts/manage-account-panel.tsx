import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { Card } from '@/components/card';
import { ListGroup, ListRow } from '@/components/list-group';
import { PasswordField } from '@/components/password-field';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { childAccounts } from '@/core/account/api';
import { id } from '@/core/i18n/id';

import { ConfirmPanel } from './confirm-panel';
import { childAccountErrorMessage, passwordRuleViews, validateResetForm } from './logic';
import { withSessionRetry } from './session-retry';

const t = id.childAccounts.manage;

type Notice = { tone: 'success' | 'error'; message: string } | null;

// Account exists: reset password, disable / enable, delete the login. Every call goes through
// the child-accounts function; the password is cleared from state as soon as it is sent.
export function ManageAccountPanel({
  childId,
  username,
  disabled,
  showVideoLink,
  onChanged,
}: {
  childId: string;
  username: string | null;
  /** child_account_disabled from list_children. */
  disabled: boolean;
  /** Offer the link to the consent screen (flag brushing_proof_video on). */
  showVideoLink: boolean;
  /** Something changed on the server: reload the account status. */
  onChanged: () => void;
}) {
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<'toggle' | 'reset' | 'delete' | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const form = validateResetForm({ password, confirm });

  function fail(code: string) {
    setNotice({ tone: 'error', message: childAccountErrorMessage(code) });
    // The row may be stale (e.g. already deleted elsewhere): refresh the status.
    if (code === 'child_not_found' || code === 'child_already_has_account') onChanged();
  }

  async function toggle(active: boolean) {
    if (busy) return;
    setBusy('toggle');
    setNotice(null);
    const res = await withSessionRetry(() => childAccounts.setDisabled({ childId, disabled: !active }));
    setBusy(null);
    if (!res.ok) return fail(res.code);
    setNotice({ tone: 'success', message: res.data.disabled ? t.disabledDone : t.enabledDone });
    onChanged();
  }

  async function reset() {
    setShowErrors(true);
    setNotice(null);
    if (!form.ok || busy) return;
    setBusy('reset');
    const res = await withSessionRetry(() => childAccounts.resetPassword({ childId, password }));
    setBusy(null);
    if (!res.ok) return fail(res.code);
    setPassword('');
    setConfirm('');
    setShowErrors(false);
    setResetOpen(false);
    setNotice({ tone: 'success', message: t.resetDone });
  }

  async function remove() {
    if (busy) return;
    setBusy('delete');
    setNotice(null);
    const res = await withSessionRetry(() => childAccounts.remove({ childId }));
    setBusy(null);
    setConfirmDelete(false);
    if (!res.ok) return fail(res.code);
    setNotice({ tone: 'success', message: t.deleted });
    onChanged();
  }

  return (
    <View className="gap-5" testID="manage-account">
      <Card className="gap-3">
        <Text variant="headline">{t.statusTitle}</Text>
        <View className="flex-row items-center justify-between gap-3">
          <Text variant="label" tone="secondary">
            {t.usernameLabel}
          </Text>
          <Text variant="bodyStrong" testID="manage-username" selectable>
            {username ?? ''}
          </Text>
        </View>
        <View className="flex-row items-center justify-between gap-3">
          <Text variant="label" tone="secondary">
            {t.statusLabel}
          </Text>
          <View className={disabled ? 'rounded-full bg-tint-peach px-3 py-1' : 'rounded-full bg-tint-mint px-3 py-1'}>
            <Text variant="label" testID="manage-status">
              {disabled ? t.statusDisabled : t.statusActive}
            </Text>
          </View>
        </View>
        <Text variant="caption" tone="secondary">
          {t.signInInfo}
        </Text>
      </Card>

      {notice ? <Banner tone={notice.tone} message={notice.message} testID="manage-notice" /> : null}

      <ListGroup footer={t.disableHint}>
        <ListRow
          icon="power-settings-new"
          iconTone={disabled ? 'coral' : 'mint'}
          title={t.disableTitle}
          accessory={
            <Switch
              testID="manage-active-switch"
              accessibilityLabel={t.disableTitle}
              checked={!disabled}
              disabled={busy !== null}
              onCheckedChange={(on) => void toggle(on)}
            />
          }
        />
      </ListGroup>

      <Card className="gap-3">
        <Text variant="headline">{t.resetTitle}</Text>
        <Text variant="caption" tone="secondary">
          {t.resetBody}
        </Text>
        {resetOpen ? (
          <View className="gap-3" testID="reset-form">
            <PasswordField
              testID="reset-password"
              label={id.childAccounts.create.password}
              error={showErrors ? form.errors.password : null}
              value={password}
              onChangeText={setPassword}
              rules={passwordRuleViews(password)}
              textContentType="newPassword"
            />
            <PasswordField
              testID="reset-confirm"
              label={id.childAccounts.create.confirm}
              error={showErrors ? form.errors.confirm : null}
              value={confirm}
              onChangeText={setConfirm}
              textContentType="newPassword"
            />
            <Button testID="reset-submit" title={t.resetSubmit} loading={busy === 'reset'} disabled={busy !== null} onPress={() => void reset()} />
            <Button
              title={t.cancel}
              variant="ghost"
              disabled={busy !== null}
              onPress={() => {
                setResetOpen(false);
                setPassword('');
                setConfirm('');
                setShowErrors(false);
              }}
            />
          </View>
        ) : (
          <Button testID="reset-open" title={t.resetOpen} variant="secondary" icon="lock-reset" onPress={() => setResetOpen(true)} />
        )}
      </Card>

      {showVideoLink ? (
        <ListGroup>
          <ListRow
            icon="videocam"
            iconTone="lavender"
            title={t.videoRow}
            subtitle={t.videoRowHint}
            onPress={() => router.push('/profile/consents')}
          />
        </ListGroup>
      ) : null}

      <Card className="gap-3" tone="peach">
        <Text variant="headline">{t.deleteTitle}</Text>
        <Text variant="caption">{t.deleteBody}</Text>
        {confirmDelete ? (
          <ConfirmPanel
            testID="delete-confirm"
            title={t.deleteConfirmTitle}
            message={t.deleteConfirmBody}
            confirmLabel={t.deleteConfirm}
            cancelLabel={t.deleteCancel}
            busy={busy === 'delete'}
            onCancel={() => setConfirmDelete(false)}
            onConfirm={() => void remove()}
          />
        ) : (
          <Button
            testID="delete-open"
            title={t.deleteOpen}
            variant="danger"
            icon="delete-outline"
            disabled={busy !== null}
            onPress={() => setConfirmDelete(true)}
          />
        )}
      </Card>
    </View>
  );
}
