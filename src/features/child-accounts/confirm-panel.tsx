import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { Button } from '@/components/ui/button';

// Inline confirmation (no system dialog): used before deleting a child login and before
// withdrawing a consent that stops data flow or hides videos. The safe choice is the primary one.
export function ConfirmPanel({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  busy = false,
  destructive = true,
  testID,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  destructive?: boolean;
  testID?: string;
}) {
  return (
    <View testID={testID} className="gap-3" accessibilityViewIsModal>
      <Banner tone="warning" title={title} message={message} />
      <View className="gap-2">
        <Button testID={testID ? `${testID}-cancel` : undefined} title={cancelLabel} variant="primary" onPress={onCancel} disabled={busy} />
        <Button
          testID={testID ? `${testID}-confirm` : undefined}
          title={confirmLabel}
          variant={destructive ? 'danger' : 'secondary'}
          loading={busy}
          disabled={busy}
          onPress={onConfirm}
        />
      </View>
    </View>
  );
}
