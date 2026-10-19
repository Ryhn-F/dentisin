import { ActivityIndicator, View } from 'react-native';

import { Banner } from '@/components/banner';
import { ConsentCard } from '@/components/consent-card';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { palette } from '@/core/theme';
import { useLocalData } from '@/data/local-store';
import type { ConsentGiver } from '@/domain/models';

import { consentCopyFor, consentTextVersionFor } from './logic';
import type { PrerequisiteState } from './use-prerequisite';

const t = id.childAccounts.prerequisite;

// Step 1: the child must exist on the server before an account can be made. The (b) consent
// grant is what creates it, so this step asks for (b), then waits for the outbox to apply it.
export function PrerequisiteStep({
  childId,
  giver,
  prerequisite,
}: {
  childId: string;
  giver: ConsentGiver;
  prerequisite: PrerequisiteState;
}) {
  const setConsent = useLocalData((s) => s.setConsent);
  const { state, offline, checking, recheck } = prerequisite;

  return (
    <View className="gap-5" testID="prerequisite-step">
      <View className="gap-1">
        <Text variant="headline">{t.title}</Text>
        <Text variant="body" tone="secondary">
          {t.body}
        </Text>
      </View>

      {state === 'needs_consent' ? (
        <ConsentCard
          testID="prerequisite-consent-b"
          icon="cloud-upload"
          copy={consentCopyFor(giver, 'b')}
          value={false}
          onValueChange={(on) => {
            if (on) setConsent(childId, 'b', true, { textVersion: consentTextVersionFor(giver, 'b') });
          }}
        />
      ) : null}

      {state === 'waiting' ? (
        <View className="items-center gap-3 rounded-card bg-card p-5" testID="prerequisite-waiting" accessibilityLiveRegion="polite">
          <ActivityIndicator size="large" color={palette.primary} />
          <Text variant="headline" className="text-center">
            {t.waitingTitle}
          </Text>
          <Text variant="body" tone="secondary" className="text-center">
            {t.waitingBody}
          </Text>
          {offline ? <Banner tone="warning" message={t.offline} testID="prerequisite-offline" /> : null}
        </View>
      ) : null}

      {state === 'rejected' ? <Banner tone="error" message={t.rejected} testID="prerequisite-rejected" /> : null}

      {state === 'waiting' || state === 'rejected' ? (
        <Button
          testID="prerequisite-retry"
          title={checking ? t.checking : t.retry}
          accessibilityHint={t.retryHint}
          variant="secondary"
          icon="refresh"
          loading={checking}
          onPress={() => void recheck()}
        />
      ) : null}
    </View>
  );
}
