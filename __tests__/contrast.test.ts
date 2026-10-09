import { contrastPairs, contrastRatio, nonTextPairs, WCAG_AA_TEXT } from '@/core/theme';

describe('theme contrast (WCAG AA)', () => {
  it('computes known reference ratios', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  it.each(contrastPairs.map((p) => [p.name, p.fg, p.bg] as const))(
    'text: %s passes 4.5:1',
    (_name, fg, bg) => {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
    },
  );

  it.each(nonTextPairs.map((p) => [p.name, p.fg, p.bg] as const))(
    'non-text: %s passes 3:1',
    (_name, fg, bg) => {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(3);
    },
  );
});
