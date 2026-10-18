import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { Button } from '@/components/ui/button';
import { id } from '@/core/i18n/id';

const t = id.proofs.list;

// Inline confirmation (no system dialog) before a clip is deleted. The safe choice is the
// primary button; deleting hides the clip at once and cannot be undone.
export function DeleteConfirm({
  busy,
  failed,
  onConfirm,
  onCancel,
  testID,
}: {
  busy: boolean;
  failed: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testID: string;
}) {
  return (
    <View testID={testID} className="gap-3" accessibilityViewIsModal>
      <Banner tone="warning" title={t.deleteTitle} message={t.deleteBody} />
      {failed ? <Banner tone="error" message={t.deleteFailed} testID={`${testID}-failed`} /> : null}
      <View className="gap-2">
        <Button testID={`${testID}-no`} title={t.deleteNo} variant="primary" onPress={onCancel} disabled={busy} />
        <Button testID={`${testID}-yes`} title={t.deleteYes} variant="danger" loading={busy} disabled={busy} onPress={onConfirm} />
      </View>
    </View>
  );
}
