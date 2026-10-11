import { router } from 'expo-router';
import { View } from 'react-native';

import { HeroHeader } from '@/components/hero-header';
import type { IconTileTone } from '@/components/icon-tile';
import { ListGroup, ListRow } from '@/components/list-group';
import { Mascot } from '@/components/mascot';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { useSession } from '@/core/auth/session-store';
import { id } from '@/core/i18n/id';
import { useUiMode } from '@/core/theme';
import type { AppRole } from '@/domain/models';
import { useMockData } from '@/mock/store';
import { ageInYears } from '@/ui/format';

const t = id.profile;
const kidTones: IconTileTone[] = ['sun', 'coral', 'mint', 'lavender'];

// The most specific role wins the badge (an account can hold several).
const rolePriority: AppRole[] = ['admin', 'facility_viewer', 'kader', 'guardian'];
const roleLabel: Record<AppRole, string> = {
  admin: t.roleAdmin,
  facility_viewer: t.roleFacility,
  kader: t.roleKader,
  guardian: t.roleGuardian,
};

function badgeRole(roles: readonly AppRole[]): AppRole {
  // Every account gets 'guardian' at sign-up (backend signup trigger).
  return rolePriority.find((r) => roles.includes(r)) ?? 'guardian';
}

export default function Profile() {
  const { mode, setMode } = useUiMode();
  const status = useSession((s) => s.status);
  const email = useSession((s) => s.email);
  const roles = useSession((s) => s.roles);
  const leaveGuest = useSession((s) => s.leaveGuest);
  const kids = useMockData((s) => s.kids);
  const guest = status === 'guest';

  return (
    <Screen flush>
      <HeroHeader ring={!guest}>
        <View className="flex-row items-center gap-4">
          <View className="size-20 items-center justify-center rounded-full bg-card">
            <Mascot size={70} />
          </View>
          <View className="flex-1 gap-1">
            <Text variant="title" numberOfLines={1}>
              {guest ? t.guestTitle : email ?? ''}
            </Text>
            {guest ? (
              <Text variant="caption">{t.guestBody}</Text>
            ) : (
              <View className="self-start rounded-full bg-sun px-3 py-1">
                <Text variant="label" tone="onAccent">
                  {roleLabel[badgeRole(roles)]}
                </Text>
              </View>
            )}
          </View>
        </View>
        {guest ? <Button title={t.guestAction} variant="accent" icon="login" onPress={() => leaveGuest()} /> : null}
      </HeroHeader>

      <View className="gap-6 px-5">
        <ListGroup title={t.kidsTitle} footer={t.kidsFooter}>
          {kids.map((kid, i) => {
            const age = ageInYears(kid.birthYear, kid.birthMonth);
            const born = kid.birthYear && kid.birthMonth ? t.born(id.months[kid.birthMonth - 1], kid.birthYear) : null;
            return (
              <ListRow
                key={kid.id}
                icon="face"
                iconTone={kidTones[i % kidTones.length]}
                title={kid.nickname}
                subtitle={[age === null ? t.ageUnknown : t.age(age), born].filter(Boolean).join(' · ')}
                onPress={() => router.push(`/profile/child/${kid.id}`)}
              />
            );
          })}
          <ListRow icon="add" iconTone="blue" title={t.addChild} onPress={() => router.push('/profile/child/new')} />
        </ListGroup>

        <ListGroup title={t.displayTitle}>
          <ListRow
            icon="child-care"
            iconTone="sun"
            title={t.childMode}
            subtitle={t.childModeHint}
            accessory={
              <Switch
                accessibilityLabel={t.childMode}
                checked={mode === 'child'}
                onCheckedChange={(on) => setMode(on ? 'child' : 'adult')}
              />
            }
          />
        </ListGroup>

        <ListGroup title={t.moreTitle}>
          <ListRow icon="settings" title={t.settings} onPress={() => router.push('/profile/settings')} />
          <ListRow icon="verified-user" iconTone="mint" title={t.consents} onPress={() => router.push('/profile/consents')} />
          <ListRow icon="info-outline" iconTone="coral" title={t.about} onPress={() => router.push('/profile/about')} />
        </ListGroup>
      </View>
    </Screen>
  );
}
