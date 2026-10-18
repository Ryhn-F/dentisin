// Runs an API call that needs the guardian's JWT. `unauthorized` / `not_authenticated` mean the
// access token is no good: refresh the session once and retry once (ACCOUNTS_AND_FLOWS 2.2).
// Never logs anything and never throws.

import type { ApiResult } from '@/core/account/api';
import { supabase } from '@/core/auth/supabase';

import { isAuthError } from './logic';

async function refreshSession(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase.auth.refreshSession();
    return !error && !!data.session;
  } catch {
    return false;
  }
}

export async function withSessionRetry<T>(call: () => Promise<ApiResult<T>>): Promise<ApiResult<T>> {
  const first = await call();
  if (first.ok || !isAuthError(first.code)) return first;
  if (!(await refreshSession())) return first;
  return call();
}
