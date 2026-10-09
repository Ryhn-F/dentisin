import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Button } from '@/components/ui/button';
import { ConsentCard } from '@/components/consent-card';
import { LevelBadge } from '@/components/level-badge';
import { id } from '@/core/i18n/id';
import { ThemeProvider, triageLevels, type UiMode } from '@/core/theme';

function inMode(mode: UiMode, ui: React.ReactElement) {
  return <ThemeProvider initialMode={mode}>{ui}</ThemeProvider>;
}

// Reanimated's Jest setup moves inline styles of animated components to `jestInlineStyle`.
function minHeightOf(el: { props: { style?: unknown; jestInlineStyle?: unknown } }): number {
  const style = StyleSheet.flatten([el.props.jestInlineStyle, el.props.style] as StyleProp<ViewStyle>);
  return Number(style?.minHeight ?? 0);
}

describe('Button', () => {
  it.each([
    ['adult', 'regular', 48],
    ['adult', 'large', 56],
    ['child', 'regular', 56],
    ['child', 'large', 64],
  ] as const)('%s mode, %s size has touch target >= %idp', async (mode, size, expected) => {
    await render(inMode(mode, <Button title="Mulai" size={size} />));
    expect(minHeightOf(screen.getByRole('button', { name: 'Mulai' }))).toBeGreaterThanOrEqual(expected);
  });

  it('calls onPress when enabled', async () => {
    const onPress = jest.fn();
    await render(<Button title="Mulai" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Mulai' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('exposes disabled state and ignores presses', async () => {
    const onPress = jest.fn();
    await render(<Button title="Mulai" disabled onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Mulai' });
    expect(button).toBeDisabled();
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('keeps its label and reports busy while loading', async () => {
    await render(<Button title="Menyimpan" loading />);
    const button = screen.getByRole('button', { name: 'Menyimpan' });
    expect(button).toBeBusy();
    expect(screen.getByText('Menyimpan')).toBeOnTheScreen();
  });
});

describe('LevelBadge', () => {
  it.each(triageLevels)('%s shows its word and advice, with an a11y label', async (level) => {
    await render(<LevelBadge level={level} />);
    const { label, advice } = id.levels[level];
    expect(screen.getByText(label)).toBeOnTheScreen();
    expect(screen.getByText(advice)).toBeOnTheScreen();
    expect(screen.getByLabelText(`${label}. ${advice}`)).toBeOnTheScreen();
  });

  it('meets the minimum touch-target height', async () => {
    await render(<LevelBadge level="routine" />);
    expect(minHeightOf(screen.getByTestId('level-badge-routine'))).toBeGreaterThanOrEqual(48);
  });
});

describe('ConsentCard', () => {
  function Harness({ onChange }: { onChange: (v: boolean) => void }) {
    // Default off, as required for every consent.
    const [value, setValue] = useState(false);
    return (
      <ConsentCard
        testID="consent"
        copy={id.consent.uploadPhoto}
        value={value}
        onValueChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
    );
  }

  it('starts off and toggles on', async () => {
    const onChange = jest.fn();
    await render(<Harness onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: id.consent.uploadPhoto.title });
    expect(toggle).not.toBeChecked();
    await fireEvent.press(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('switch', { name: id.consent.uploadPhoto.title })).toBeChecked();
  });

  it('shows what, why, where and if-declined text', async () => {
    await render(<Harness onChange={() => {}} />);
    const copy = id.consent.uploadPhoto;
    for (const text of [copy.title, copy.what, copy.why, copy.where, copy.ifDeclined]) {
      expect(screen.getByText(text)).toBeOnTheScreen();
    }
  });
});
