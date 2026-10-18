import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Chip } from '@/components/chip';
import { ListGroup, ListRow } from '@/components/list-group';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useCapabilities } from '@/core/account/account-store';
import { id } from '@/core/i18n/id';
import { newChildId, useLocalData } from '@/data/local-store';
import { allergenCodes, type AllergenCode } from '@/domain/models';
import { childAccountStatus, consentTextVersionFor } from '@/features/child-accounts/logic';
import { useChildSummaries } from '@/features/child-accounts/use-child-summaries';

const t = id.child;
const ta = id.childAccounts.section;
const NICKNAME_MAX = 24;

// Years offered: 0–18 years (recommender valid_age_months 0–216).
function birthYears(now = new Date()): number[] {
  const current = now.getFullYear();
  return Array.from({ length: 19 }, (_, i) => current - i);
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <Text variant="headline">{title}</Text>
      {hint ? (
        <Text variant="caption" tone="secondary">
          {hint}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

export default function ChildEditor() {
  const { id: childId } = useLocalSearchParams<{ id: string }>();
  const hasExisting = useLocalData((s) => s.kids.some((k) => k.id === childId));
  // The form starts from the stored child. It remounts per child (and once that child's data is
  // on the phone) instead of copying store updates into state, which would also wipe edits in
  // progress whenever the record changes (e.g. when it syncs).
  return <ChildEditorForm key={`${childId}:${hasExisting}`} childId={childId} />;
}

function ChildEditorForm({ childId }: { childId: string }) {
  const isNew = childId === 'new';
  const existing = useLocalData((s) => s.kids.find((k) => k.id === childId));
  const upsertChild = useLocalData((s) => s.upsertChild);
  const setActiveChild = useLocalData((s) => s.setActiveChild);
  const setConsent = useLocalData((s) => s.setConsent);
  // "Akun anak" is only for guardians who may create child accounts (never for a teen's own profile).
  const showAccount = useCapabilities().createChildAccounts && existing?.isSelf !== true;
  const summaries = useChildSummaries({ enabled: showAccount && !isNew });
  const reloadSummaries = summaries.reload;
  useFocusEffect(
    useCallback(() => {
      if (showAccount && !isNew) void reloadSummaries();
    }, [showAccount, isNew, reloadSummaries]),
  );
  const accountStatus = childAccountStatus(summaries.rows[childId]);

  const [nickname, setNickname] = useState(existing?.nickname ?? '');
  const [birthMonth, setBirthMonth] = useState<number | null>(existing?.birthMonth ?? null);
  const [birthYear, setBirthYear] = useState<number | null>(existing?.birthYear ?? null);
  const [allergies, setAllergies] = useState<string[]>(existing?.allergies ?? []);
  const [error, setError] = useState<string | null>(null);

  function toggleAllergy(code: AllergenCode) {
    setAllergies((list) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]));
  }

  function onSave() {
    const name = nickname.trim();
    if (!name) {
      setError(t.nicknameRequired);
      return;
    }
    const targetId = isNew ? newChildId() : childId;
    upsertChild({
      id: targetId,
      nickname: name.slice(0, NICKNAME_MAX),
      birthMonth,
      birthYear,
      allergies,
    });
    if (isNew) {
      setConsent(targetId, 'a', true, { textVersion: consentTextVersionFor('guardian', 'a') });
    }
    setActiveChild(targetId);
    router.back();
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: isNew ? t.newTitle : t.editTitle }} />

      <TextField
        label={t.nickname}
        helper={t.nicknameHelper}
        error={error}
        value={nickname}
        onChangeText={(v) => {
          setNickname(v);
          if (error) setError(null);
        }}
        maxLength={NICKNAME_MAX}
        autoCapitalize="words"
      />

      <Section title={t.birthMonth}>
        <View className="flex-row flex-wrap gap-2">
          {id.months.map((label, i) => (
            <Chip
              key={label}
              label={label}
              accessibilityLabel={id.monthsLong[i]}
              selected={birthMonth === i + 1}
              onPress={() => setBirthMonth(i + 1)}
            />
          ))}
        </View>
      </Section>

      <Section title={t.birthYear}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-5" contentContainerClassName="gap-2 px-5 py-1">
          {birthYears().map((year) => (
            <Chip key={year} label={String(year)} selected={birthYear === year} onPress={() => setBirthYear(year)} />
          ))}
        </ScrollView>
      </Section>

      <Section title={t.allergies} hint={t.allergiesHelper}>
        <View className="flex-row flex-wrap gap-2">
          {allergenCodes.map((code) => (
            <Chip
              key={code}
              label={t.allergenLabels[code]}
              icon={allergies.includes(code) ? 'check' : undefined}
              selected={allergies.includes(code)}
              onPress={() => toggleAllergy(code)}
            />
          ))}
        </View>
      </Section>

      {showAccount ? (
        <Section title={ta.title} hint={isNew ? ta.saveFirst : ta.hint}>
          {isNew ? null : (
            <ListGroup>
              <ListRow
                testID="child-account-row"
                icon="key"
                iconTone="mint"
                title={accountStatus === 'none' ? ta.openCreate : ta.openManage}
                subtitle={
                  accountStatus === 'active'
                    ? ta.statusActive
                    : accountStatus === 'disabled'
                      ? ta.statusDisabled
                      : accountStatus === 'none'
                        ? ta.statusNone
                        : ta.statusUnknown
                }
                onPress={() => router.push(`/profile/child-account/${childId}`)}
              />
            </ListGroup>
          )}
        </Section>
      ) : null}

      <Button title={id.common.save} variant="accent" size="large" onPress={onSave} />
    </Screen>
  );
}
