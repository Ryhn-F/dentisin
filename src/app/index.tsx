import { Redirect } from 'expo-router';

import { useSession } from '@/core/auth/session-store';

// Entry gate: the root layout has already restored local state behind the splash.
export default function Index() {
  const status = useSession((s) => s.status);
  if (status === 'loading') return null;
  return <Redirect href={status === 'signedIn' || status === 'guest' ? '/home' : '/welcome'} />;
}
