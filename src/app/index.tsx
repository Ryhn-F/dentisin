import { Redirect } from 'expo-router';

import { useAccount } from '@/core/account/account-store';
import { homePath, resolveHome } from '@/core/account/routing';
import { useSession } from '@/core/auth/session-store';

// Entry gate: the root layout has already restored local state (session + cached account)
// behind the splash. Every Stack.Protected guard that turns false falls back to this screen.
export default function Index() {
  const status = useSession((s) => s.status);
  const me = useAccount((s) => s.me);
  const accountStatus = useAccount((s) => s.status);
  if (status === 'loading') return null;
  return <Redirect href={homePath[resolveHome(status, me, accountStatus)]} />;
}
