import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { captchaPageUrl, config } from '@/core/config';
import {
  isAllowedCaptchaNavigation,
  parseCaptchaMessage,
  tokenFromCaptchaUrl,
  type CaptchaAction,
} from '@/core/auth/captcha';
import type { CaptchaStatus } from '@/core/auth/use-captcha';
import { id } from '@/core/i18n/id';
import { palette } from '@/core/theme';

import { Icon } from './icon';
import { Button } from './ui/button';
import { Text } from './ui/text';

const t = id.auth;
// Fits the host page's message line + the 65dp Turnstile widget (backend/web/captcha).
const WIDGET_HEIGHT = 150;

// Cloudflare Turnstile via the backend's host page (backend/web/captcha/index.html) in a
// WebView; the page posts the one-time token back (contract: src/core/auth/captcha.ts).
// Only the PUBLIC site key is in the app; the secret lives in Supabase Auth.
// Remount (change `key`) after each submit: tokens are single-use.
export function Turnstile({
  action,
  status,
  onToken,
  onError,
  onRetry,
  testID,
}: {
  action: CaptchaAction;
  status: CaptchaStatus;
  onToken: (token: string) => void;
  onError: (code: string) => void;
  onRetry: () => void;
  testID?: string;
}) {
  const siteKey = config.turnstileSiteKey;
  if (!siteKey || status === 'off') return null; // CAPTCHA off in this build.

  function onMessage(event: WebViewMessageEvent) {
    const msg = parseCaptchaMessage(event.nativeEvent.data);
    if (msg.kind === 'token') onToken(msg.token);
    else if (msg.kind === 'error') onError(msg.code);
  }

  return (
    <View testID={testID} className="gap-2">
      <View className="flex-row items-center gap-2 px-1">
        <Icon name={status === 'ready' ? 'verified-user' : 'shield'} size={18} color={status === 'ready' ? palette.success : palette.textSecondary} />
        <Text variant="label" tone={status === 'ready' ? 'success' : 'secondary'}>
          {status === 'ready' ? t.captchaDone : t.captchaLabel}
        </Text>
      </View>
      <View
        className="overflow-hidden rounded-tile border-[1.5px] border-separator"
        style={{ height: WIDGET_HEIGHT, borderCurve: 'continuous' }}
        accessibilityLabel={t.captchaLabel}
      >
        <WebView
          source={{ uri: captchaPageUrl(siteKey, action) }}
          onMessage={onMessage}
          originWhitelist={['https://*', 'about:*']}
          javaScriptEnabled
          // The page needs no storage; keep the WebView stateless.
          incognito
          setSupportMultipleWindows={false}
          onShouldStartLoadWithRequest={(req) => {
            const fallbackToken = tokenFromCaptchaUrl(req.url);
            if (fallbackToken) {
              onToken(fallbackToken);
              return false;
            }
            return isAllowedCaptchaNavigation(req.url, config.turnstileBaseUrl);
          }}
          onError={() => onError('load_failed')}
          onHttpError={() => onError('load_failed')}
          scrollEnabled={false}
          style={{ backgroundColor: 'transparent' }}
        />
      </View>
      {status === 'error' ? (
        <View className="gap-1">
          <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
            {t.captchaFailed}
          </Text>
          <Button title={t.captchaRetry} variant="ghost" icon="refresh" onPress={onRetry} className="self-start" />
        </View>
      ) : null}
    </View>
  );
}
