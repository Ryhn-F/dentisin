import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { Card } from '@/components/card';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';

const t = id.childAccounts.created;

function Line({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View className="gap-0.5 rounded-tile bg-bg p-4" accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="label" tone="secondary">
        {label}
      </Text>
      <Text variant="headline" testID={testID} selectable>
        {value}
      </Text>
    </View>
  );
}

// Shown once after the account is created: how the child signs in. The password itself is never
// shown or kept (the guardian just typed it); this card only reminds which password it is.
export function CreatedCard({
  parentEmail,
  username,
  videoConsent,
  onDone,
}: {
  parentEmail: string | null;
  username: string;
  videoConsent: boolean;
  onDone: () => void;
}) {
  return (
    <View className="gap-5" testID="created-card">
      <Card tone="mint" className="gap-4">
        <Text variant="title">{t.title}</Text>
        <Text variant="body">{t.intro}</Text>
        <Text variant="bodyStrong">{t.step1}</Text>
        {parentEmail ? <Line label={t.emailLabel} value={parentEmail} testID="created-email" /> : null}
        <Line label={t.nameLabel} value={username} testID="created-username" />
        <Line label={t.passwordLabel} value={t.passwordValue} />
      </Card>
      <Banner tone="warning" message={t.oneTime} testID="created-one-time" />
      {videoConsent ? <Banner tone="info" message={t.videoOn} /> : null}
      <Button testID="created-done" title={t.done} variant="accent" size="large" onPress={onDone} />
    </View>
  );
}
