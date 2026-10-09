import { config } from '@/core/config';
import { id } from '@/core/i18n/id';

import { Banner } from './banner';

// Web is a visual preview only (react-native-webview has no web implementation).
// Sign-in with CAPTCHA must be tested on Android.
export function Turnstile(_props: { onToken: (token: string | null) => void; testID?: string }) {
  if (!config.turnstileSiteKey) return null;
  return <Banner tone="info" message={id.auth.captchaWebPreview} />;
}
