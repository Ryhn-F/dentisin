import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Chip } from '@/components/chip';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { id } from '@/core/i18n/id';
import { allergenCodes, type AllergenCode } from '@/domain/models';
import { newChildId, useMockData } from '@/mock/store';

const t = id.child;
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
  const isNew = childId === 'new';
  const existing = useMockData((s) => s.kids.find((k) => k.id === childId));
  const upsertChild = useMockData((s) => s.upsertChild);

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
    upsertChild({
      id: isNew ? newChildId() : childId,
      nickname: name.slice(0, NICKNAME_MAX),
      birthMonth,
      birthYear,
      allergies,
    });
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

      <Button title={id.common.save} variant="accent" size="large" onPress={onSave} />
    </Screen>
  );
}
