// Sign-up in two steps (src/features/auth/register-screen.tsx): role cards, the teen birth step
// with its age gate, then the form with a "Ganti" header and signUp with the account type.
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { clearPendingTeenBirth, setPendingTeenBirth, signUp } from '@/core/auth/auth-service';
import { id } from '@/core/i18n/id';
import { RegisterScreen } from '@/features/auth/register-screen';

jest.mock('@/core/auth/auth-service', () => ({
  signUp: jest.fn(),
  setPendingTeenBirth: jest.fn(),
  clearPendingTeenBirth: jest.fn(),
}));
jest.mock('@/core/auth/supabase', () => ({ supabase: null }));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() }, useFocusEffect: jest.fn() }));
jest.mock('@/components/turnstile', () => ({ Turnstile: () => null }));
jest.mock('@/core/config', () => ({ ...jest.requireActual('@/core/config'), isSupabaseConfigured: true, captchaEnabled: false }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { router } = require('expo-router') as { router: { replace: jest.Mock } };

const NOW = new Date('2026-10-18T05:00:00Z');
const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
async function renderScreen() {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <RegisterScreen now={NOW} />
    </SafeAreaProvider>,
  );
}

const signUpMock = signUp as jest.Mock;
const r = id.registerFlow;

function continueDisabled(): boolean {
  return screen.getByTestId('register-birth-continue').props.accessibilityState?.disabled === true;
}

async function fillForm() {
  await fireEvent.changeText(screen.getByLabelText(id.auth.email), 'remaja@contoh.com');
  await fireEvent.changeText(screen.getByLabelText(id.auth.password), 'Rahasia1');
  await fireEvent.changeText(screen.getByLabelText(id.auth.passwordConfirm), 'Rahasia1');
  await fireEvent.press(screen.getByTestId('privacy-agree'));
}

beforeEach(() => {
  signUpMock.mockReset().mockResolvedValue({ ok: true, needsConfirmation: true });
  (setPendingTeenBirth as jest.Mock).mockReset().mockResolvedValue(undefined);
  (clearPendingTeenBirth as jest.Mock).mockReset().mockResolvedValue(undefined);
  router.replace.mockReset();
});

describe('RegisterScreen', () => {
  it('starts with two role cards and no form', async () => {
    await renderScreen();
    expect(screen.getByText(r.role.heroTitle)).toBeTruthy();
    expect(screen.getByText(r.role.guardian.title)).toBeTruthy();
    expect(screen.getByText(r.role.teen.title)).toBeTruthy();
    expect(screen.queryByTestId('register-submit')).toBeNull();
  });

  it('signs a guardian up with the guardian type and clears an old teen birth', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('register-role-guardian'));
    expect(screen.getByText(r.form.typeGuardian)).toBeTruthy();
    await fillForm();
    await fireEvent.press(screen.getByTestId('register-submit'));
    await waitFor(() => expect(signUpMock).toHaveBeenCalled());
    expect(signUpMock.mock.calls[0].slice(0, 3)).toEqual(['remaja@contoh.com', 'Rahasia1', 'guardian']);
    expect(clearPendingTeenBirth).toHaveBeenCalled();
    expect(setPendingTeenBirth).not.toHaveBeenCalled();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/check-email'));
  });

  it('asks a teen for the birth before the form and stores it for the setup screen', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('register-role-teen'));
    expect(screen.queryByTestId('register-submit')).toBeNull();
    // Nothing picked yet: cannot continue.
    expect(continueDisabled()).toBe(true);

    await fireEvent.press(screen.getByTestId('birth-year-2009'));
    await fireEvent.press(screen.getByTestId('birth-month-5'));
    await fireEvent.press(screen.getByTestId('register-birth-continue'));

    expect(screen.getByTestId('register-type-header')).toBeTruthy();
    expect(screen.getByText(r.form.born('Mei 2009'))).toBeTruthy();
    await fillForm();
    await fireEvent.press(screen.getByTestId('register-submit'));
    await waitFor(() => expect(signUpMock).toHaveBeenCalled());
    expect(signUpMock.mock.calls[0][2]).toBe('teen');
    expect(setPendingTeenBirth).toHaveBeenCalledWith({ year: 2009, month: 5 });
  });

  it('accepts a year alone when every possible age fits', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('register-role-teen'));
    await fireEvent.press(screen.getByTestId('birth-year-2009'));
    await fireEvent.press(screen.getByTestId('birth-month-none'));
    expect(continueDisabled()).toBe(false);
  });

  it('asks for the month when the year alone straddles the minimum age', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('register-role-teen'));
    await fireEvent.press(screen.getByTestId('birth-year-2011'));
    expect(screen.getByTestId('age-gate-needs-month')).toBeTruthy();
    expect(continueDisabled()).toBe(true);
    await fireEvent.press(screen.getByTestId('birth-month-10')); // turns 15 this month
    expect(screen.queryByTestId('age-gate-needs-month')).toBeNull();
    expect(continueDisabled()).toBe(false);
  });

  it('explains the parent route for under 15 and switches to the guardian form', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('register-role-teen'));
    await fireEvent.press(screen.getByTestId('birth-year-2013'));
    expect(screen.getByTestId('age-gate-too-young')).toBeTruthy();
    expect(continueDisabled()).toBe(true);
    await fireEvent.press(screen.getByTestId('age-gate-action'));
    expect(screen.getByText(r.form.typeGuardian)).toBeTruthy();
    expect(screen.getByTestId('register-submit')).toBeTruthy();
  });

  it('points over-19s to the guardian option as well', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('register-role-teen'));
    await fireEvent.press(screen.getByTestId('birth-year-2003'));
    expect(screen.getByTestId('age-gate-too-old')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('age-gate-action'));
    expect(screen.getByText(r.form.typeGuardian)).toBeTruthy();
  });

  it('lets the person change the type from the form', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('register-role-guardian'));
    await fireEvent.press(screen.getByTestId('register-change-type'));
    expect(screen.getByTestId('register-role-teen')).toBeTruthy();
    expect(screen.queryByTestId('register-submit')).toBeNull();
  });

  it('validates the form locally and does not call signUp', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('register-role-guardian'));
    await fireEvent.press(screen.getByTestId('register-submit'));
    expect(screen.getByText(id.auth.fieldErrors.emailRequired)).toBeTruthy();
    expect(signUpMock).not.toHaveBeenCalled();
  });
});
