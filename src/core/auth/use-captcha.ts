import { useRef, useState } from 'react';

import { captchaEnabled } from '@/core/config';

import type { CaptchaAction } from './captcha';

// How long a submit waits for the widget before letting the server decide.
const TOKEN_WAIT_MS = 10_000;

export type CaptchaStatus = 'off' | 'loading' | 'ready' | 'error';

/**
 * One Turnstile widget per form. Tokens are single-use: `take()` hands the current token
 * to one request (waiting briefly if the widget is still working) and `reset()` loads a
 * fresh widget afterwards.
 *
 * It never blocks a submit on the client: if the widget failed or timed out, the request
 * goes without a token and Supabase decides (CAPTCHA may still be off server-side —
 * backend/supabase/config.toml `[auth.captcha] enabled`); a refusal comes back as
 * `captcha_failed` and is shown inline.
 */
export function useCaptcha(action: CaptchaAction) {
  const [widgetKey, setWidgetKey] = useState(0);
  const [status, setStatus] = useState<CaptchaStatus>(captchaEnabled ? 'loading' : 'off');
  const token = useRef<string | null>(null);
  const failed = useRef(false);
  const waiters = useRef<((token: string | null) => void)[]>([]);

  function settle(value: string | null) {
    const pending = waiters.current;
    waiters.current = [];
    pending.forEach((resolve) => resolve(value));
  }

  function reset() {
    if (!captchaEnabled) return;
    token.current = null;
    failed.current = false;
    setStatus('loading');
    setWidgetKey((k) => k + 1);
  }

  function onToken(value: string) {
    token.current = value;
    failed.current = false;
    setStatus('ready');
    settle(value);
  }

  function onError(code: string) {
    // An expired token is routine (5 minutes): load a fresh widget silently.
    if (code === 'expired') {
      reset();
      return;
    }
    token.current = null;
    failed.current = true;
    setStatus('error');
    settle(null);
  }

  async function take(): Promise<string | undefined> {
    if (!captchaEnabled) return undefined;
    const ready = token.current;
    token.current = null;
    if (ready) return ready;
    if (failed.current) return undefined;
    const value = await new Promise<string | null>((resolve) => {
      waiters.current.push(resolve);
      setTimeout(() => resolve(null), TOKEN_WAIT_MS);
    });
    token.current = null;
    return value ?? undefined;
  }

  return {
    status,
    take,
    reset,
    /** Remount key: pass as `key` on <Turnstile>. */
    widgetKey,
    widgetProps: { action, onToken, onError },
  };
}
