import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { getRememberedParentEmail, signInChild } from '@/core/auth/auth-service';
import { id } from '@/core/i18n/id';
import { ChildLoginScreen } from '@/features/auth/child-login-screen';
import { childLoginMessage, lockoutSeconds } from '@/features/auth/child-login-errors';

jest.mock('@/core/auth/auth-service', () => ({
  signInChild: jest.fn(),
  getRememberedParentEmail: jest.fn(),
}));
jest.mock('@/core/auth/supabase', () => ({ supabase: null }));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() }, useFocusEffect: jest.fn() }));
jest.mock('@/components/turnstile', () => ({ Turnstile: () => null }));
jest.mock('@/core/config', () => ({ ...jest.requireActual('@/core/config'), isSupabaseConfigured: true, captchaEnabled: false }));

const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
async function renderScreen() {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ChildLoginScreen />
    </SafeAreaProvider>,
  );
}

const signIn = signInChild as jest.Mock;
const remembered = getRememberedParentEmail as jest.Mock;
const t = id.childLogin;

async function fill(email: string, username: string, password: string) {
  await fireEvent.changeText(screen.getByTestId('child-login-email'), email);
  await fireEvent.changeText(screen.getByTestId('child-login-username'), username);
  await fireEvent.changeText(screen.getByTestId('child-login-password'), password);
}

beforeEach(() => {
  signIn.mockReset();
  remembered.mockReset().mockResolvedValue(null);
});

describe('ChildLoginScreen', () => {
  it('prefills the remembered parent email', async () => {
    remembered.mockResolvedValue('ortu@contoh.com');
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('child-login-email').props.value).toBe('ortu@contoh.com'));
  });

  it('validates locally without calling the server', async () => {
    await renderScreen();
    await fill('bukan-email', 'Bad Name!', '');
    await fireEvent.press(screen.getByTestId('child-login-submit'));
    expect(screen.getByText(t.fieldErrors.emailInvalid)).toBeTruthy();
    expect(screen.getByText(t.fieldErrors.usernameInvalid)).toBeTruthy();
    expect(screen.getByText(t.fieldErrors.passwordRequired)).toBeTruthy();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('normalizes the username and submits', async () => {
    signIn.mockResolvedValue({ ok: true, account: null });
    await renderScreen();
    await fill('ortu@contoh.com', ' Budi01 ', 'Rahasia1');
    await fireEvent.press(screen.getByTestId('child-login-submit'));
    expect(signIn).toHaveBeenCalledWith(
      expect.objectContaining({ parentEmail: 'ortu@contoh.com', username: 'budi01', password: 'Rahasia1' }),
    );
  });

  it('shows one uniform message for invalid credentials and not_child', async () => {
    await renderScreen();
    await fill('ortu@contoh.com', 'budi01', 'Salah123');
    signIn.mockResolvedValueOnce({ ok: false, code: 'invalid_credentials' });
    await fireEvent.press(screen.getByTestId('child-login-submit'));
    expect(screen.getByText(t.errors.invalidCredentials)).toBeTruthy();
    expect(childLoginMessage('not_child')).toBe(childLoginMessage('invalid_credentials'));
  });

  it('maps busy and not_deployed codes', () => {
    expect(childLoginMessage('upstream_unavailable')).toBe(t.errors.busy);
    expect(childLoginMessage('network')).toBe(t.errors.busy);
    expect(childLoginMessage('not_deployed')).toBe(t.errors.notDeployed);
    expect(lockoutSeconds(undefined)).toBe(60);
    expect(lockoutSeconds(12.2)).toBe(13);
  });

  it('disables submit during a 429 countdown and re-enables it afterwards', async () => {
    jest.useFakeTimers();
    try {
      signIn.mockResolvedValue({ ok: false, code: 'too_many_attempts', retryAfterS: 3 });
      await renderScreen();
      await fill('ortu@contoh.com', 'budi01', 'Salah123');
      await fireEvent.press(screen.getByTestId('child-login-submit'));
      expect(screen.getByText(t.errors.tooManyAttempts)).toBeTruthy();
      expect(screen.getByText(t.submitWait(3))).toBeTruthy();
      expect(screen.getByTestId('child-login-submit').props.accessibilityState?.disabled).toBe(true);

      // A press while locked does nothing.
      await fireEvent.press(screen.getByTestId('child-login-submit'));
      expect(signIn).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(3500);
      });
      expect(screen.getByText(t.submit)).toBeTruthy();
      expect(screen.getByTestId('child-login-submit').props.accessibilityState?.disabled).toBeFalsy();
    } finally {
      jest.useRealTimers();
    }
  });
});
