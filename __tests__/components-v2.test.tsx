import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Banner } from '@/components/banner';
import { ChildSwitcher } from '@/components/child-switcher';
import { EmptyState } from '@/components/empty-state';
import { FeatureTile } from '@/components/feature-tile';
import { ListGroup, ListRow } from '@/components/list-group';
import { PasswordField } from '@/components/password-field';
import { ProgressRing } from '@/components/progress-ring';
import { SegmentedControl } from '@/components/segmented-control';
import { StreakCounter, StreakWeek, type StreakDay } from '@/components/streak';
import { SyncStatusPill } from '@/components/sync-status-pill';
import { TextField } from '@/components/text-field';
import { Checkbox } from '@/components/ui/checkbox';
import { checkPassword } from '@/core/auth/validation';
import { id } from '@/core/i18n/id';
import { ThemeProvider } from '@/core/theme';
import { cn } from '@/lib/utils';

// Reanimated's Jest setup moves inline styles of animated components to `jestInlineStyle`.
function minHeight(el: { props: { style?: unknown; jestInlineStyle?: unknown } }): number {
  const style = StyleSheet.flatten([el.props.jestInlineStyle, el.props.style] as StyleProp<ViewStyle>);
  return Number(style?.minHeight ?? 0);
}

describe('StreakWeek / StreakCounter', () => {
  const days: StreakDay[] = [0, 1, 2, 3, 4, 5, 6].map((i) => ({
    date: `2026-10-${String(5 + i).padStart(2, '0')}`,
    weekday: i,
    morning: i <= 3,
    evening: i <= 2,
    isToday: i === 3,
    isFuture: i > 3,
  }));

  it('describes every day in words, not only dots', async () => {
    await render(<StreakWeek days={days} />);
    const s = id.components.streak;
    expect(screen.getByLabelText(`${s.weekdaysLong[0]}: ${s.morning} ${s.done}, ${s.evening} ${s.done}`)).toBeOnTheScreen();
    expect(screen.getByLabelText(`${s.weekdaysLong[3]}: ${s.morning} ${s.done}, ${s.evening} ${s.notYet}`)).toBeOnTheScreen();
    expect(screen.getByLabelText(`${s.weekdaysLong[6]}: ${s.morning} ${s.upcoming}, ${s.evening} ${s.upcoming}`)).toBeOnTheScreen();
  });

  it('announces the count with its unit', async () => {
    await render(<StreakCounter count={12} />);
    expect(screen.getByLabelText(`12 ${id.components.streak.daysInARow}`)).toBeOnTheScreen();
  });
});

describe('form fields', () => {
  it('TextField shows the error instead of the helper', async () => {
    await render(<TextField label="Email" helper="Bantuan" error="Format email belum benar." value="x" />);
    expect(screen.getByText('Format email belum benar.')).toBeOnTheScreen();
    expect(screen.queryByText('Bantuan')).toBeNull();
    expect(screen.getByLabelText('Email')).toBeOnTheScreen();
  });

  it('PasswordField toggles visibility and lists rules', async () => {
    function Harness() {
      const [pw, setPw] = useState('abc');
      return <PasswordField label="Kata sandi" value={pw} onChangeText={setPw} rules={checkPassword(pw)} />;
    }
    await render(<Harness />);
    const input = screen.getByLabelText('Kata sandi');
    expect(input.props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: id.components.password.show }));
    expect(screen.getByLabelText('Kata sandi').props.secureTextEntry).toBe(false);
    const p = id.auth.passwordRules;
    expect(screen.getByLabelText(`${p.length}: ${id.components.password.ruleNotMet}`)).toBeOnTheScreen();
    expect(screen.getByLabelText(`${p.lower}: ${id.components.password.ruleMet}`)).toBeOnTheScreen();
  });
});

describe('selection controls', () => {
  it('SegmentedControl marks the selected tab and reports changes', async () => {
    const onChange = jest.fn();
    await render(
      <SegmentedControl
        options={[
          { value: 'a', label: 'Sikat gigi' },
          { value: 'b', label: 'Skrining' },
        ]}
        value="a"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Sikat gigi' })).toBeSelected();
    await fireEvent.press(screen.getByRole('tab', { name: 'Skrining' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('ChildSwitcher selects a child; hit area reaches the touch target', async () => {
    const onChange = jest.fn();
    await render(
      <ChildSwitcher
        kids={[
          { id: 'c1', nickname: 'Adik' },
          { id: 'c2', nickname: 'Kakak' },
        ]}
        activeId="c1"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('button', { name: 'Adik' })).toBeSelected();
    await fireEvent.press(screen.getByRole('button', { name: 'Kakak' }));
    expect(onChange).toHaveBeenCalledWith('c2');
  });
});

describe('FeatureTile', () => {
  it('a "soon" tile is disabled and says why', async () => {
    const onPress = jest.fn();
    await render(
      <FeatureTile icon="photo-camera" tone="lavender" title="Skrining" status="soon" statusLabel="Segera hadir" onPress={onPress} />,
    );
    const tile = screen.getByRole('button', { name: 'Skrining. Segera hadir' });
    expect(tile).toBeDisabled();
    await fireEvent.press(tile);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('meets the large touch target in child mode', async () => {
    await render(
      <ThemeProvider initialMode="child">
        <FeatureTile icon="timer" tone="blue" title="Sikat" onPress={() => {}} />
      </ThemeProvider>,
    );
    expect(minHeight(screen.getByRole('button', { name: 'Sikat' }))).toBeGreaterThanOrEqual(64);
  });
});

describe('lists, banners, states', () => {
  it('ListRow is a button with a combined label when pressable', async () => {
    const onPress = jest.fn();
    await render(
      <ListGroup title="Lainnya">
        <ListRow title="Pengaturan akun" value="Segera" onPress={onPress} />
        <ListRow title="Email" value="a@b.co" />
      </ListGroup>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Pengaturan akun, Segera' }));
    expect(onPress).toHaveBeenCalled();
    expect(screen.getByText('a@b.co')).toBeOnTheScreen();
  });

  it('error banner is announced as an alert', async () => {
    await render(<Banner tone="error" message="Email atau kata sandi salah." />);
    expect(screen.getByRole('alert')).toBeOnTheScreen();
  });

  it('EmptyState action is a button', async () => {
    const onPress = jest.fn();
    await render(<EmptyState icon="timer" title="Kosong" action={{ label: 'Tambah anak', onPress }} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Tambah anak' }));
    expect(onPress).toHaveBeenCalled();
  });

  it('SyncStatusPill uses words for each state', async () => {
    await render(<SyncStatusPill status="local" />);
    expect(screen.getByLabelText(id.components.sync.local)).toBeOnTheScreen();
  });

  it('ProgressRing exposes progress to screen readers', async () => {
    await render(<ProgressRing progress={0.25} accessibilityLabel="Sisa waktu" />);
    expect(screen.getByRole('progressbar', { name: 'Sisa waktu' }).props.accessibilityValue).toEqual({
      min: 0,
      max: 100,
      now: 25,
    });
  });
});

describe('cn (tailwind-merge extended for custom tokens)', () => {
  // Regression: without registering custom font sizes, `text-title` is treated as a
  // color and silently drops `text-ink` (or vice versa).
  it('keeps a custom text size and a text color together', () => {
    expect(cn('text-title text-ink')).toBe('text-title text-ink');
    expect(cn('text-body-child text-primary-on')).toBe('text-body-child text-primary-on');
  });

  it('still lets later classes of the same group win', () => {
    expect(cn('text-body', 'text-title')).toBe('text-title');
    expect(cn('text-ink', 'text-ink-soft')).toBe('text-ink-soft');
    expect(cn('px-5 pt-4', 'pt-0')).toBe('px-5 pt-0');
  });
});

describe('Checkbox and Switch (React Native Reusables primitives)', () => {
  it('Checkbox exposes checked state and toggles', async () => {
    function Harness() {
      const [v, setV] = useState(false);
      return <Checkbox checked={v} onCheckedChange={setV} accessibilityLabel="Setuju" />;
    }
    await render(<Harness />);
    const box = screen.getByRole('checkbox', { name: 'Setuju' });
    expect(box).not.toBeChecked();
    await fireEvent.press(box);
    expect(screen.getByRole('checkbox', { name: 'Setuju' })).toBeChecked();
  });
});
