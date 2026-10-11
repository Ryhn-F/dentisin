import type { CaptchaAction } from '@/core/auth/captcha';
import type { CaptchaStatus } from '@/core/auth/use-captcha';
import { config } from '@/core/config';
import { id } from '@/core/i18n/id';

import { Banner } from './banner';

// Web is a visual preview only (react-native-webview has no web implementation), so the
// web build sends no CAPTCHA token (`captchaEnabled` is false). Test CAPTCHA on Android.
export function Turnstile(_props: {
  action: CaptchaAction;
  status: CaptchaStatus;
  onToken: (token: string) => void;
  onError: (code: string) => void;
  onRetry: () => void;
  testID?: string;
}) {
  if (!config.turnstileSiteKey) return null;
  return <Banner tone="info" message={id.auth.captchaWebPreview} />;
}
