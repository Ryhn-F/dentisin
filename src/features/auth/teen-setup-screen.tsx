import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { ConsentCard } from '@/components/consent-card';
import { HeroHeader } from '@/components/hero-header';
import { Mascot } from '@/components/mascot';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { ensureSelfProfile, type ApiErrorCode } from '@/core/account/api';
import { useAccount, useLimits, useMe } from '@/core/account/account-store';
import { clearPendingTeenBirth, getPendingTeenBirth } from '@/core/auth/auth-service';
import { useSession } from '@/core/auth/session-store';
import { id } from '@/core/i18n/id';
import { useLocalData } from '@/data/local-store';
import { consentTextVersions, type ConsentType } from '@/domain/models';
import { newUuid } from '@/core/util/uuid';

import { evaluateTeenAge } from './register-age';
import { AgeGateNotice, BirthPicker } from './register-birth-picker';

const t = id.teenSetup;

type TeenConsent = Extract<ConsentType, 'a' | 'b' | 'd'>;

// Message for a failed ensure_self_profile call; `null` code means "use the generic text".
function errorMessage(code: ApiErrorCode, min: number, max: number): string {
  switch (code) {
    case 'age_out_of_range':
      return t.errors.ageOutOfRange(min, max);
    case 'network':
      return t.errors.network;
    case 'not_deployed':
      return t.errors.notDeployed;
    case 'not_authenticated':
      return t.errors.sessionExpired;
    default:
      return t.errors.unknown;
  }
}

// First run of a teen account (ACCOUNTS_AND_FLOWS.md §2.1, §2.8): confirm birth year and month,
// choose the teen consents (all off), then ensure_self_profile creates the self profile. The root
// router shows this screen while a teen account has no self_child_id and moves on by itself once
// the refreshed my_account() has one. The consent (c) is not offered (photo upload is off).
export function TeenSetupScreen({ now }: { /** Injected in tests; defaults to the current date. */ now?: Date }) {
  const me = useMe();
  const limits = useLimits();
  const videoOffered = me?.flags.brushingProofVideo === true;

  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [consent, setConsent] = useState<Record<TeenConsent, boolean>>({ a: false, b: false, d: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  // One id per screen visit: a retry after a lost answer reuses it (the server call is idempotent).
  const selfId = useRef<string | null>(null);
  const mounted = useRef(true);
  const touchedBirth = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Prefill with the birth the teen gave before sign-up, unless they already picked something.
  useEffect(() => {
    let live = true;
    void getPendingTeenBirth().then((pending) => {
      if (!live || !pending || touchedBirth.current) return;
      setYear(pending.year);
      setMonth(pending.month);
    });
    return () => {
      live = false;
    };
  }, []);

  const bounds = useMemo(() => ({ min: limits.teenMinAge, max: limits.teenMaxAge }), [limits.teenMinAge, limits.teenMaxAge]);
  const gate = useMemo(() => (year === null ? null : evaluateTeenAge(year, month, now, bounds)), [year, month, now, bounds]);
  const birthOk = gate?.status === 'ok';

  function pickYear(next: number) {
    touchedBirth.current = true;
    setYear(next);
    setError(null);
  }
  function pickMonth(next: number | null) {
    touchedBirth.current = true;
    setMonth(next);
    setError(null);
  }

  // Video proof (d) needs technical data sync (b): the (d) switch stays locked until (b) is on,
  // and withdrawing (b) also withdraws (d). Turning (d) on never turns (b) on: every consent is
  // its own opt-in, never bundled (app/CLAUDE.md §3.5), as on the consents screen.
  function toggle(type: TeenConsent, value: boolean) {
    setConsent((c) => {
      if (type === 'd' && value && !c.b) return c;
      const next = { ...c, [type]: value };
      if (type === 'b' && !value) next.d = false;
      return next;
    });
  }

  async function onSubmit() {
    if (busy || year === null || !birthOk) return;
    setError(null);
    setCanRetry(false);
    setBusy(true);
    selfId.current ??= newUuid();
    const result = await ensureSelfProfile(selfId.current, year, month);
    if (!result.ok) {
      if (!mounted.current) return;
      setBusy(false);
      setError(errorMessage(result.code, bounds.min, bounds.max));
      setCanRetry(result.code === 'network' || result.code === 'unknown');
      return;
    }
    // Always the id the server returned. The self profile is local-first from here on.
    const local = useLocalData.getState();
    local.ensureSelfProfile({ childId: result.data, birthYear: year, birthMonth: month, nickname: t.selfNickname });
    const granted = (['a', 'b', 'd'] as const).filter((type) => consent[type] && (type !== 'd' || videoOffered));
    for (const type of granted) {
      local.setConsent(result.data, type, true, { textVersion: consentTextVersions.teen[type] });
    }
    await clearPendingTeenBirth();
    // The router leaves this screen once my_account() reports the self profile.
    await useAccount.getState().refresh();
    if (!mounted.current) return;
    setBusy(false);
    // my_account() could not be read (e.g. the connection dropped after ensure_self_profile):
    // say so and offer a retry instead of a screen where nothing seems to happen. The retry
    // repeats the idempotent call with the same id.
    if (!useAccount.getState().me?.selfChildId) {
      setError(t.errors.refreshFailed);
      setCanRetry(true);
    }
  }

  function signOut() {
    void useSession.getState().signOut();
  }

  const { min, max } = bounds;
  const copy = t.consents;
  // The same teen texts as the consents screen: their text_version ids are what gets recorded.
  const teenCopy = id.consentsV2.teen;
  const showTooYoungExtra = gate?.status === 'too_young' || error === t.errors.ageOutOfRange(min, max);

  return (
    <Screen flush>
      <HeroHeader>
        <View className="flex-row items-end justify-between">
          <View className="flex-1 gap-2 pr-2">
            <Text variant="display" accessibilityRole="header">
              {t.heroTitle}
            </Text>
            <Text variant="body">{t.heroBody}</Text>
          </View>
          <Mascot size={88} mood="wow" />
        </View>
      </HeroHeader>

      <View className="gap-5 px-5">
        <View className="gap-3">
          <View className="gap-1">
            <Text variant="headline" accessibilityRole="header">
              {t.birth.title}
            </Text>
            <Text variant="caption" tone="secondary">
              {t.birth.help}
            </Text>
          </View>
          <BirthPicker year={year} month={month} onYearChange={pickYear} onMonthChange={pickMonth} now={now} testID="teen-birth" />
          {gate ? (
            <AgeGateNotice gate={gate} bounds={bounds} extra={showTooYoungExtra ? t.tooYoungExtra : undefined} testID="teen-age-gate" />
          ) : null}
        </View>

        <View className="gap-3">
          <View className="gap-1">
            <Text variant="headline" accessibilityRole="header">
              {copy.title}
            </Text>
            <Text variant="caption" tone="secondary">
              {copy.intro}
            </Text>
          </View>

          <ConsentCard
            testID="teen-consent-a"
            icon="phone-android"
            copy={teenCopy.a}
            value={consent.a}
            onValueChange={(v) => toggle('a', v)}
          />
          <ConsentCard
            testID="teen-consent-b"
            icon="cloud-upload"
            copy={teenCopy.b}
            value={consent.b}
            onValueChange={(v) => toggle('b', v)}
          />
          {videoOffered ? (
            <ConsentCard
              testID="teen-consent-d"
              icon="videocam"
              copy={teenCopy.d}
              value={consent.d}
              disabled={!consent.b && !consent.d}
              onValueChange={(v) => toggle('d', v)}
              note={consent.b ? undefined : copy.needsB}
            />
          ) : null}
          <Text variant="caption" tone="secondary">
            {id.consentsV2.draftNote}
          </Text>
        </View>

        {error ? (
          <Banner
            testID="teen-setup-error"
            tone="error"
            message={error}
            action={
              canRetry ? (
                <Button title={t.errors.retry} variant="secondary" className="mt-2 self-start" onPress={onSubmit} testID="teen-setup-retry" />
              ) : undefined
            }
          />
        ) : null}

        <View className="gap-3">
          <Button
            title={t.submit}
            size="large"
            loading={busy}
            disabled={!birthOk}
            accessibilityHint={year === null ? id.registerFlow.birth.yearRequired : undefined}
            onPress={onSubmit}
            testID="teen-setup-submit"
          />
          <Button title={t.signOut} variant="ghost" onPress={signOut} testID="teen-setup-signout" />
        </View>
      </View>
    </Screen>
  );
}
