import { useState } from 'react';
import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { ChildSwitcher } from '@/components/child-switcher';
import { ConsentCard } from '@/components/consent-card';
import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { Text } from '@/components/ui/text';
import { useMe } from '@/core/account/account-store';
import { useSession } from '@/core/auth/session-store';
import { flags } from '@/core/flags';
import { id } from '@/core/i18n/id';
import { useLocalData } from '@/data/local-store';
import type { ConsentType } from '@/domain/models';

import { ConfirmPanel } from './confirm-panel';
import {
  consentCopyFor,
  consentGiverFor,
  consentTextVersionFor,
  kidLabel,
  needsWithdrawConfirmation,
  visibleConsentTypes,
} from './logic';
import { useChildSummaries } from './use-child-summaries';

const t = id.consentsV2;

const icons: Record<ConsentType, 'smartphone' | 'cloud-upload' | 'photo-camera' | 'videocam'> = {
  a: 'smartphone',
  b: 'cloud-upload',
  c: 'photo-camera',
  d: 'videocam',
};

// One card per consent type, per child; never bundled and always off until switched on.
// Guardian wording for a guardian's children, first-person teen wording for a teen's own profile.
// Toggling goes through the local store, which records the text version and tells the sync
// bridge (consent_changed). (c) is shown locked while dataset_contribution is off; (d) only
// while the server flag brushing_proof_video is on.
export function ConsentsScreen() {
  const me = useMe();
  const status = useSession((s) => s.status);
  const allKids = useLocalData((s) => s.kids);
  const storedActive = useLocalData((s) => s.activeChildId);
  const setActive = useLocalData((s) => s.setActiveChild);
  const setConsent = useLocalData((s) => s.setConsent);
  const summaries = useChildSummaries();
  const [withdraw, setWithdraw] = useState<{ childId: string; type: 'b' | 'd' } | null>(null);

  // A teen only has the own profile; everyone else sees all children.
  const kids =
    me?.accountType === 'teen'
      ? allKids.filter((k) => k.isSelf === true || k.id === me.selfChildId)
      : allKids;
  const activeId = kids.some((k) => k.id === storedActive) ? storedActive : (kids[0]?.id ?? null);
  const kid = kids.find((k) => k.id === activeId) ?? null;
  const values = useLocalData((s) => (activeId ? s.consents[activeId] : undefined));
  const records = useLocalData((s) => (activeId ? s.consentRecords[activeId] : undefined));

  if (!kid || !activeId) {
    return (
      <Screen>
        <EmptyState mascot="thinking" title={t.noChild} testID="consents-empty" />
      </Screen>
    );
  }

  const giver = consentGiverFor(kid, me?.accountType);
  const state = values ?? { a: false, b: false, c: false, d: false };
  const proofVideo = me?.flags.brushingProofVideo === true;
  const options = kids.map((k) => ({ id: k.id, nickname: kidLabel(k, allKids.indexOf(k)) }));
  const name = options.find((o) => o.id === activeId)?.nickname ?? '';
  const hasChildAccount = summaries.rows[activeId]?.hasChildAccount === true;

  function change(type: ConsentType, value: boolean) {
    if (!activeId) return;
    if (!value && needsWithdrawConfirmation(type)) {
      setWithdraw({ childId: activeId, type });
      return;
    }
    setConsent(activeId, type, value, { textVersion: consentTextVersionFor(giver, type) });
  }

  function confirmWithdraw() {
    if (withdraw) setConsent(withdraw.childId, withdraw.type, false, { textVersion: consentTextVersionFor(giver, withdraw.type) });
    setWithdraw(null);
  }

  function noteFor(type: ConsentType): string | undefined {
    if (type === 'c') return t.notActiveNote;
    if (type === 'd' && !state.b) return t.dNeedsB;
    if (type === 'd' && giver === 'guardian' && summaries.loaded && !hasChildAccount) return t.dNoChildAccount;
    if (status === 'signedIn' && records?.[type] && records[type]?.synced === false) return t.pendingSync;
    return undefined;
  }

  const confirm = withdraw && withdraw.childId === activeId ? (withdraw.type === 'b' ? t.withdrawB : t.withdrawD) : null;

  return (
    <Screen className="gap-5">
      {status === 'guest' ? <Banner tone="info" message={t.signInNote} testID="consents-guest-note" /> : null}
      {kids.length > 1 ? (
        <ChildSwitcher
          kids={options}
          activeId={activeId}
          onChange={(next) => {
            setWithdraw(null);
            setActive(next);
          }}
        />
      ) : null}
      <Text variant="body" tone="secondary">
        {kid.isSelf ? t.introSelf : t.intro(name)}
      </Text>
      {confirm ? (
        <ConfirmPanel
          testID="consent-withdraw-confirm"
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirm}
          cancelLabel={confirm.cancel}
          onConfirm={confirmWithdraw}
          onCancel={() => setWithdraw(null)}
        />
      ) : null}
      <View className="gap-5">
        {visibleConsentTypes({ proofVideo }).map((type) => {
          const locked = type === 'c' && !flags.dataset_contribution;
          return (
            <ConsentCard
              key={type}
              testID={`consent-${type}`}
              icon={icons[type]}
              copy={consentCopyFor(giver, type)}
              value={locked ? false : state[type]}
              disabled={locked || (type === 'd' && !state.b && !state.d)}
              badge={locked ? t.statusNotActive : undefined}
              note={noteFor(type)}
              onValueChange={(v) => change(type, v)}
            />
          );
        })}
      </View>
      <Text variant="caption" tone="secondary">
        {t.draftNote}
      </Text>
    </Screen>
  );
}
