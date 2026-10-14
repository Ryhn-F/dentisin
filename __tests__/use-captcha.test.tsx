import { act, renderHook } from '@testing-library/react-native';

import { useCaptcha } from '@/core/auth/use-captcha';

// Pretend this is the Android build with a Turnstile site key.
jest.mock('@/core/config', () => ({ ...jest.requireActual('@/core/config'), captchaEnabled: true }));

describe('useCaptcha', () => {
  it('waits for the widget token, hands it to one request, then needs a fresh widget', async () => {
    const { result } = await renderHook(() => useCaptcha('login'));
    expect(result.current.status).toBe('loading');

    let taken: Promise<string | undefined> | undefined;
    await act(async () => {
      taken = result.current.take();
      result.current.widgetProps.onToken('0.token-one');
    });
    await expect(taken).resolves.toBe('0.token-one');
    expect(result.current.status).toBe('ready');

    // Single use: after reset the widget remounts and the old token is gone.
    const before = result.current.widgetKey;
    await act(async () => result.current.reset());
    expect(result.current.widgetKey).toBe(before + 1);
    expect(result.current.status).toBe('loading');
  });

  it('does not block a submit after the widget failed (the server decides)', async () => {
    const { result } = await renderHook(() => useCaptcha('signup'));
    await act(async () => result.current.widgetProps.onError('110200'));
    expect(result.current.status).toBe('error');
    await expect(result.current.take()).resolves.toBeUndefined();
  });

  it('reloads silently when a token expires', async () => {
    const { result } = await renderHook(() => useCaptcha('reset'));
    await act(async () => result.current.widgetProps.onToken('0.token-old'));
    const before = result.current.widgetKey;
    await act(async () => result.current.widgetProps.onError('expired'));
    expect(result.current.widgetKey).toBe(before + 1);
    expect(result.current.status).toBe('loading');
  });

  it('gives up waiting after 10 s and sends the request without a token', async () => {
    jest.useFakeTimers();
    try {
      const { result } = await renderHook(() => useCaptcha('resend'));
      const taken = result.current.take();
      jest.advanceTimersByTime(10_000);
      await expect(taken).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});
