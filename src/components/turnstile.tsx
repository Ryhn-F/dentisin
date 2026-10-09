import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { config } from '@/core/config';
import { id } from '@/core/i18n/id';

import { Text } from './ui/text';

// Cloudflare Turnstile in a WebView (Supabase CAPTCHA, backend config.toml [auth.captcha]).
// Tokens are single-use: re-mount the widget (change its `key`) after each submit.
// Only the PUBLIC site key lives in the app; the secret is set in the Supabase dashboard.

const ALLOWED_PREFIXES = ['about:', 'https://challenges.cloudflare.com'];

function html(siteKey: string) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onLoad&render=explicit" async defer></script>
</head><body style="margin:0;display:flex;justify-content:center;background:transparent">
<div id="w"></div>
<script>
function post(type, value){ window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, value: value || null })); }
function onLoad(){
  turnstile.render('#w', {
    sitekey: ${JSON.stringify(siteKey)},
    language: 'id',
    theme: 'light',
    callback: function(token){ post('token', token); },
    'expired-callback': function(){ post('expired'); },
    'error-callback': function(code){ post('error', String(code)); }
  });
}
</script></body></html>`;
}

export function Turnstile({
  onToken,
  testID,
}: {
  /** Called with a token, or null when it expired / failed. */
  onToken: (token: string | null) => void;
  testID?: string;
}) {
  const siteKey = config.turnstileSiteKey;
  if (!siteKey) return null; // CAPTCHA off (local dev); the server decides if that is allowed.

  function onMessage(event: WebViewMessageEvent) {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as { type: string; value: string | null };
      onToken(msg.type === 'token' && msg.value ? msg.value : null);
    } catch {
      onToken(null);
    }
  }

  return (
    <View testID={testID} className="h-[72px] gap-1" accessibilityLabel={id.auth.captchaLabel}>
      <WebView
        source={{ html: html(siteKey), baseUrl: config.turnstileBaseUrl }}
        onMessage={onMessage}
        originWhitelist={['*']}
        javaScriptEnabled
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={(req) =>
          req.url.startsWith(config.turnstileBaseUrl) || ALLOWED_PREFIXES.some((p) => req.url.startsWith(p))
        }
        style={{ backgroundColor: 'transparent' }}
        scrollEnabled={false}
      />
      <Text variant="caption" tone="secondary" className="text-center">
        {id.auth.captchaHint}
      </Text>
    </View>
  );
}
