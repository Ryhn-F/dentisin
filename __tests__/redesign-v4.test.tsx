import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { StyleSheet, Text as RNText, type StyleProp, type ViewStyle } from 'react-native';

import { CheckboxField } from '@/components/checkbox-field';
import { ScreeningCard } from '@/components/screening-card';
import { PressableScale } from '@/components/ui/pressable-scale';
import { setStorageBackendForTests, type KeyValueBackend } from '@/core/auth/secure-storage';
import { id } from '@/core/i18n/id';
import { usePrefs } from '@/core/prefs';
import { ThemeProvider } from '@/core/theme';
import { useLocalData } from '@/data/local-store';

type StyledNode = {
  props: { style?: unknown; jestInlineStyle?: unknown };
  queryAll?: (predicate: (node: StyledNode) => boolean) => StyledNode[];
};

function styleOf(node: StyledNode): ViewStyle {
  return StyleSheet.flatten([node.props.jestInlineStyle, node.props.style] as StyleProp<ViewStyle>) ?? {};
}

function allStyles(el: StyledNode): ViewStyle[] {
  return [el, ...(el.queryAll?.(() => true) ?? [])].map(styleOf);
}

describe('PressableScale layout (Android collapse regression)', () => {
  // On Android, a growing child inside a `self-*` aligned Pressable collapsed to zero
  // width and an endless height ("Baca pemberitahuan privasi", "Lupa kata sandi?").
  it('does not let its layers grow unless `fill` is set', async () => {
    await render(
      <PressableScale accessibilityRole="button" accessibilityLabel="Tautan" containerClassName="self-start" minHeight={48}>
        <RNText>Tautan</RNText>
      </PressableScale>,
    );
    const styles = allStyles(screen.getByRole('button', { name: 'Tautan' }));
    expect(styles.some((s) => s.flexGrow)).toBe(false);
    expect(Math.max(...styles.map((s) => Number(s.minHeight ?? 0)))).toBe(48);
  });

  it('grows with its container when `fill` is set (equal-height tiles)', async () => {
    await render(
      <PressableScale accessibilityRole="button" accessibilityLabel="Ubin" fill>
        <RNText>Ubin</RNText>
      </PressableScale>,
    );
    const styles = allStyles(screen.getByRole('button', { name: 'Ubin' }));
    expect(styles.some((s) => s.flexGrow === 1)).toBe(true);
  });
});

describe('CheckboxField', () => {
  function Harness({ error }: { error?: string }) {
    const [checked, setChecked] = useState(false);
    return <CheckboxField label={id.auth.privacyAgree} checked={checked} onCheckedChange={setChecked} error={error} />;
  }

  it('is one checkbox for the whole row and toggles from anywhere on it', async () => {
    await render(<Harness />);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(1);
    const row = screen.getByRole('checkbox', { name: id.auth.privacyAgree });
    expect(row).not.toBeChecked();
    await fireEvent.press(row);
    expect(row).toBeChecked();
    await fireEvent.press(row);
    expect(row).not.toBeChecked();
  });

  it('shows the error under the row', async () => {
    await render(<Harness error={id.auth.fieldErrors.privacyRequired} />);
    expect(screen.getByText(id.auth.fieldErrors.privacyRequired)).toBeOnTheScreen();
  });

  it('meets the touch target in child mode', async () => {
    await render(
      <ThemeProvider initialMode="child">
        <Harness />
      </ThemeProvider>,
    );
    const styles = allStyles(screen.getByRole('checkbox', { name: id.auth.privacyAgree }));
    expect(Math.max(...styles.map((s) => Number(s.minHeight ?? 0)))).toBeGreaterThanOrEqual(56);
  });
});

describe('ScreeningCard', () => {
  it('is a button that says the feature is not available yet', async () => {
    const onPress = jest.fn();
    await render(<ScreeningCard onPress={onPress} />);
    const card = screen.getByRole('button', { name: new RegExp(id.common.soon) });
    expect(card).toHaveAccessibleName(new RegExp(id.home.screeningCardTitle));
    await fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('local store', () => {
  it('starts every consent off for a new child', () => {
    // Plain store call: nothing is rendered, so no act() is needed.
    useLocalData.getState().upsertChild({ id: 'test-child', nickname: 'Uji', birthYear: null, birthMonth: null, allergies: [] });
    expect(useLocalData.getState().consents['test-child']).toEqual({ a: false, b: false, c: false, d: false });
  });
});

describe('display preferences', () => {
  function memoryBackend(): KeyValueBackend & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getItem: async (k) => data.get(k) ?? null,
      setItem: async (k, v) => {
        data.set(k, v);
      },
      removeItem: async (k) => {
        data.delete(k);
      },
    };
  }

  afterEach(() => setStorageBackendForTests(null));

  it('remembers child mode across restarts', async () => {
    const backend = memoryBackend();
    setStorageBackendForTests(backend);
    usePrefs.setState({ mode: 'adult', hydrated: false });
    usePrefs.getState().setMode('child');
    await new Promise((r) => setTimeout(r, 0));

    // "Restart": reset memory, read back from storage.
    usePrefs.setState({ mode: 'adult', hydrated: false });
    await usePrefs.getState().hydrate();
    expect(usePrefs.getState()).toMatchObject({ mode: 'child', hydrated: true });
  });

  it('falls back to adult mode when storage cannot be read', async () => {
    setStorageBackendForTests({
      getItem: async () => {
        throw new Error('keystore unavailable');
      },
      setItem: async () => {},
      removeItem: async () => {},
    });
    usePrefs.setState({ mode: 'adult', hydrated: false });
    await usePrefs.getState().hydrate();
    expect(usePrefs.getState()).toMatchObject({ mode: 'adult', hydrated: true });
  });
});
