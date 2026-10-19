import fs from 'node:fs';
import path from 'node:path';

import { id } from '@/core/i18n/id';
import { findForbidden, forbiddenPhrases } from '@/core/i18n/forbidden-phrases';

function collectStrings(node: unknown, keyPath: string, out: [string, string][]) {
  if (typeof node === 'string') {
    out.push([keyPath, node]);
  } else if (typeof node === 'function') {
    // Dynamic strings: render with sample arguments so templates are scanned too.
    const sample = Array.from({ length: node.length }, (_, i) => (i === 0 ? 'Adik' : 5));
    const text = (node as (...args: unknown[]) => unknown)(...sample);
    if (typeof text === 'string') out.push([`${keyPath}()`, text]);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      collectStrings(value, keyPath ? `${keyPath}.${key}` : key, out);
    }
  }
}

describe('findForbidden', () => {
  it('matches whole words only, case-insensitive', () => {
    expect(findForbidden('Data Anda aman')).toEqual(['aman']);
    expect(findForbidden('Fitur keamanan dan pemandangan')).toEqual([]);
    expect(findForbidden('Hasil PASTI benar')).toEqual(['pasti']);
    expect(findForbidden('memastikan foto jelas')).toEqual([]);
  });

  it('flags symbols and multi-word phrases', () => {
    expect(findForbidden('100% akurat')).toContain('100%');
    expect(findForbidden('Anak Anda menderita karies')).toEqual(
      expect.arrayContaining(['anda menderita', 'anak anda menderita']),
    );
  });

  it('allows the mandatory disclaimer', () => {
    expect(findForbidden(id.common.disclaimer)).toEqual([]);
  });
});

describe('UI strings (src/core/i18n/id.ts)', () => {
  const strings: [string, string][] = [];
  collectStrings(id, '', strings);

  it('has strings to scan', () => {
    expect(strings.length).toBeGreaterThan(10);
  });

  it('also scans the feature modules in src/core/i18n/features (mounted as id.<name>)', () => {
    const keys = new Set(strings.map(([key]) => key.split('.')[0]));
    for (const name of [
      'registerFlow', 'teenSetup', 'childLogin', 'accountGate', 'homeV2', 'kid', 'childAccounts',
      'consentsV2', 'requests', 'screeningSync', 'recording', 'proofs', 'timeline', 'syncV2', 'deletion',
    ]) {
      expect(keys).toContain(name);
    }
  });

  it.each(strings)('%s contains no forbidden phrase', (_key, text) => {
    expect(findForbidden(text)).toEqual([]);
  });
});

// Parity with the shared doc (ADR 010). Skipped when app/ is used outside the monorepo.
const sharedDoc = path.resolve(__dirname, '../../docs/style/forbidden_phrases.md');
const describeIfShared = fs.existsSync(sharedDoc) ? describe : describe.skip;

describeIfShared('parity with docs/style/forbidden_phrases.md', () => {
  it('app list covers every quoted phrase in the shared doc', () => {
    const rows = fs
      .readFileSync(sharedDoc, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('|') && !line.startsWith('|---'))
      .slice(1); // header row
    const docPhrases = rows.flatMap((row) => {
      const firstCell = row.split('|')[1] ?? '';
      return [...firstCell.matchAll(/"([^"]+)"/g)].map((m) =>
        m[1].replace(/…/g, '').replace(/\s*XX%/i, '').trim().toLowerCase(),
      );
    });
    expect(docPhrases.length).toBeGreaterThan(0);
    const missing = docPhrases.filter((p) => !forbiddenPhrases.includes(p));
    expect(missing).toEqual([]);
  });
});
