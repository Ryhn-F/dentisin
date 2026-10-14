import { router } from 'expo-router';
import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { Card } from '@/components/card';
import { ChildSwitcher } from '@/components/child-switcher';
import { Sparkle } from '@/components/decor';
import { HeroHeader } from '@/components/hero-header';
import { Icon, type IconName } from '@/components/icon';
import { IconTile, type IconTileTone } from '@/components/icon-tile';
import { Mascot } from '@/components/mascot';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { flags } from '@/core/flags';
import { id } from '@/core/i18n/id';
import { palette } from '@/core/theme';
import { DraftNotice } from '@/features/screening/components/draft-notice';
import { ageInMonths } from '@/features/screening/pipeline';
import { useScreeningSession } from '@/features/screening/session-store';
import { useMockData } from '@/mock/store';

const t = id.screening;
const stepLook: { icon: IconName; tone: IconTileTone }[] = [
  { icon: 'question-answer', tone: 'blue' },
  { icon: 'flashlight-on', tone: 'sun' },
  { icon: 'fact-check', tone: 'coral' },
];

function HowItWorks() {
  return (
    <View className="gap-3">
      <Text variant="title" accessibilityRole="header">
        {t.stepsTitle}
      </Text>
      {t.steps.map((step, i) => (
        <View
          key={step.title}
          accessible
          accessibilityLabel={`${t.stepLabel(i + 1, t.steps.length)}. ${step.title}. ${step.body}`}
          className="flex-row items-center gap-4 rounded-card bg-card p-4"
          style={{ borderCurve: 'continuous' }}
        >
          <View>
            <IconTile name={stepLook[i].icon} tone={stepLook[i].tone} size={56} />
            <View className="absolute -left-2 -top-2 size-7 items-center justify-center rounded-full border-2 border-card bg-ink">
              <Text variant="label" tone="onPrimary" style={{ fontSize: 13, lineHeight: 16 }}>
                {i + 1}
              </Text>
            </View>
          </View>
          <View className="flex-1 gap-0.5">
            <Text variant="bodyStrong">{step.title}</Text>
            <Text variant="caption" tone="secondary">
              {step.body}
            </Text>
          </View>
        </View>
      ))}
      <Text variant="caption" tone="secondary" className="px-1">
        {id.common.disclaimer}
      </Text>
    </View>
  );
}

function PrivacyCard() {
  return (
    <Card tone="mint" className="flex-row items-center gap-4">
      <IconTile name="lock" tone="white" size={48} />
      <View className="flex-1 gap-1">
        <Text variant="headline">{t.privacyTitle}</Text>
        <Text variant="caption" tone="secondary">
          {t.privacyBody}
        </Text>
      </View>
    </Card>
  );
}

function Hero({ soon }: { soon: boolean }) {
  return (
    // No ring: the camera badge owns the bottom-right corner.
    <HeroHeader withNavHeader={false} ring={false}>
      {soon ? (
        <View className="flex-row items-center gap-1.5 self-start rounded-full bg-sun py-1.5 pl-2.5 pr-3.5">
          <Icon name="schedule" size={16} color={palette.onAccent} />
          <Text variant="label" tone="onAccent">
            {t.statusSoon}
          </Text>
        </View>
      ) : null}
      <View className="flex-row items-center gap-3">
        <View className="flex-1 gap-2">
          <Text variant="display" accessibilityRole="header">
            {t.title}
          </Text>
          <Text variant="body">{t.heroBody}</Text>
        </View>
        <View className="size-32 items-center justify-center rounded-full bg-primary-deep">
          <Sparkle color={palette.accent} size={22} style={{ left: 2, top: 6 }} />
          <Mascot size={104} mood="wow" />
          <View className="absolute -bottom-1 -right-1">
            <IconTile name="photo-camera" tone="sun" size={44} round />
          </View>
        </View>
      </View>
    </HeroHeader>
  );
}

// While `medical_modules` is off (public builds, ADR 002) the page explains how screening will
// work and offers useful actions meanwhile — it never pretends to screen.
function ComingSoon() {
  return (
    <>
      <Card className="gap-4 p-6">
        <View className="flex-row items-center gap-3">
          <IconTile name="hourglass-top" tone="lavender" size={44} />
          <Text variant="headline" className="flex-1">
            {t.waitingTitle}
          </Text>
        </View>
        <Text variant="body" tone="secondary">
          {t.waitingBody}
        </Text>
        <Button title={t.brushAction} icon="play-arrow" variant="accent" onPress={() => router.push('/brushing/session')} />
        <Button
          title={t.learnAction}
          variant="secondary"
          icon="local-hospital"
          onPress={() => router.push('/feature/education/kapan-ke-dokter')}
        />
      </Card>
      <HowItWorks />
      <PrivacyCard />
    </>
  );
}

// Start of the flow: questionnaire -> red flags -> photo -> quality gate -> triage.
function StartScreening() {
  const kids = useMockData((s) => s.kids);
  const activeId = useMockData((s) => s.activeChildId);
  const setActive = useMockData((s) => s.setActiveChild);
  const start = useScreeningSession((s) => s.start);
  const child = kids.find((k) => k.id === activeId) ?? null;
  const ageKnown = child ? ageInMonths(child.birthYear, child.birthMonth) !== null : false;

  return (
    <>
      <DraftNotice />
      <Card className="gap-4 p-6">
        <View className="flex-row items-center gap-3">
          <IconTile name="photo-camera" tone="blue" size={44} />
          <View className="flex-1">
            <Text variant="headline">{t.startTitle}</Text>
            <Text variant="caption" tone="secondary">
              {t.startBody}
            </Text>
          </View>
        </View>
        {kids.length ? (
          <View className="gap-2">
            <Text variant="label" tone="secondary">
              {t.chooseChild}
            </Text>
            <ChildSwitcher kids={kids} activeId={activeId} onChange={setActive} />
          </View>
        ) : (
          <Banner
            tone="info"
            title={t.noChildTitle}
            message={t.noChildBody}
            action={
              <Button
                title={t.addChild}
                variant="ghost"
                icon="person-add"
                className="self-start"
                onPress={() => router.push('/profile/child/new')}
              />
            }
          />
        )}
        {child && !ageKnown ? <Banner tone="warning" message={t.ageUnknown} /> : null}
        <Button
          testID="screening-start"
          title={child ? t.startFor(child.nickname) : t.startAction}
          icon="play-arrow"
          variant="accent"
          size="large"
          onPress={() => {
            start(child);
            router.push('/screening/questions');
          }}
        />
        <Text variant="caption" tone="secondary" className="text-center">
          {t.adultNote}
        </Text>
      </Card>
      <HowItWorks />
      <PrivacyCard />
    </>
  );
}

// Main feature, in the middle of the tab bar.
export default function Screening() {
  const enabled = flags.medical_modules;
  return (
    <Screen flush topScrim={{ color: 'primary', height: 'statusBar' }}>
      <Hero soon={!enabled} />
      <View className="gap-7 px-5">{enabled ? <StartScreening /> : <ComingSoon />}</View>
    </Screen>
  );
}
