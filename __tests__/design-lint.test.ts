// Automates the greppable anti-slop checks from app/docs/design_principles.md §10.
// Node-based so it runs on Windows without grep.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const themeDir = path.join(root, 'src', 'core', 'theme');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const files = sourceFiles(path.join(root, 'src'));

type Rule = { name: string; pattern: RegExp; skipTheme?: boolean };

const rules: Rule[] = [
  { name: 'hex color outside src/core/theme', pattern: /#[0-9a-fA-F]{3,8}\b/, skipTheme: true },
  { name: 'Touchable* (use Pressable)', pattern: /\bTouchable(Opacity|Highlight|WithoutFeedback)\b/ },
  { name: 'Alert.alert (inline feedback or undo instead)', pattern: /\bAlert\.alert\b/ },
  { name: 'decorative gradient', pattern: /\bLinearGradient\b|experimental_backgroundImage/ },
  { name: 'font scaling disabled', pattern: /allowFontScaling=\{false\}/ },
  { name: 'legacy elevation/shadow props', pattern: /\belevation:|\bshadow(Color|Offset|Opacity|Radius):/ },
  { name: 'emoji used in UI code', pattern: /[\p{Extended_Pictographic}\u{FE0F}]/u },
];

describe('design lint (anti-slop)', () => {
  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(rules.map((r) => [r.name, r] as const))('no %s', (_name, rule) => {
    const hits = files
      .filter((file) => !(rule.skipTheme && file.startsWith(themeDir)))
      .flatMap((file) =>
        fs
          .readFileSync(file, 'utf8')
          .split('\n')
          .flatMap((line, i) =>
            rule.pattern.test(line) ? [`${path.relative(root, file)}:${i + 1}: ${line.trim()}`] : [],
          ),
      );
    expect(hits).toEqual([]);
  });
});
