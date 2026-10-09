import { Banner } from '@/components/banner';
import { ChildSwitcher } from '@/components/child-switcher';
import { ConsentCard } from '@/components/consent-card';
import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { Text } from '@/components/ui/text';
import { flags } from '@/core/flags';
import { id } from '@/core/i18n/id';
import { useMockData } from '@/mock/store';

const t = id.consents;

// One card per consent type (a/b/c), never bundled. (c) photo upload stays hidden
// while `dataset_contribution` is off (no ethics approval yet).
export default function Consents() {
  const kids = useMockData((s) => s.kids);
  const activeId = useMockData((s) => s.activeChildId);
  const setActive = useMockData((s) => s.setActiveChild);
  const consents = useMockData((s) => (activeId ? s.consents[activeId] : undefined));
  const setConsent = useMockData((s) => s.setConsent);
  const kid = kids.find((k) => k.id === activeId);

  if (!kid || !activeId) {
    return (
      <Screen>
        <EmptyState mascot="thinking" title={t.noChild} />
      </Screen>
    );
  }

  const state = consents ?? { a: false, b: false, c: false };

  return (
    <Screen className="gap-5">
      <Banner tone="info" message={id.common.previewData} />
      <ChildSwitcher kids={kids} activeId={activeId} onChange={setActive} />
      <Text variant="body" tone="secondary">
        {t.intro(kid.nickname)}
      </Text>
      <ConsentCard
        testID="consent-a"
        icon="smartphone"
        copy={id.consent.storeLocal}
        value={state.a}
        onValueChange={(v) => setConsent(activeId, 'a', v)}
      />
      <ConsentCard
        testID="consent-b"
        icon="cloud-upload"
        copy={id.consent.technicalData}
        value={state.b}
        onValueChange={(v) => setConsent(activeId, 'b', v)}
      />
      {flags.dataset_contribution ? (
        <ConsentCard
          testID="consent-c"
          icon="photo-camera"
          copy={id.consent.uploadPhoto}
          value={state.c}
          onValueChange={(v) => setConsent(activeId, 'c', v)}
        />
      ) : (
        <Text variant="caption" tone="secondary">
          {t.photoHidden}
        </Text>
      )}
    </Screen>
  );
}
