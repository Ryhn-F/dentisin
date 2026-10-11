// The bundled copies in assets/rules/ must equal what scripts/sync-backend-assets.js builds from
// the backend sources (ADR 010: the app bundles a copy, a test keeps it in sync).
import fs from 'node:fs';
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildAssets, parseSimpleYaml } = require('../scripts/sync-backend-assets');

const backend = path.resolve(__dirname, '../../backend');
const describeIfBackend = fs.existsSync(path.join(backend, 'triage/dist/rules.json')) ? describe : describe.skip;

describeIfBackend('assets/rules is in sync with the backend', () => {
  const built: Record<string, string> = buildAssets(backend);

  it.each(Object.keys(built))('%s', (name) => {
    const bundled = fs.readFileSync(path.resolve(__dirname, '../assets/rules', name), 'utf8');
    // Compare with LF line endings so a CRLF checkout does not fail.
    expect(bundled.replace(/\r\n/g, '\n')).toBe(built[name].replace(/\r\n/g, '\n'));
  });
});

describe('parseSimpleYaml', () => {
  it('reads nested mappings of scalars and ignores comments', () => {
    expect(parseSimpleYaml('a: 1 # note\nb:\n  c: 0.5\n  d: null\n  e: text\n  f: "q"\ng: true\n')).toEqual({
      a: 1,
      b: { c: 0.5, d: null, e: 'text', f: 'q' },
      g: true,
    });
  });

  it('refuses YAML it does not understand', () => {
    expect(() => parseSimpleYaml('a:\n  - 1\n')).toThrow('unsupported YAML');
    expect(() => parseSimpleYaml('a: [1, 2]\n')).toThrow('unsupported YAML');
    expect(() => parseSimpleYaml(' a: 1\n')).toThrow('unsupported YAML');
  });
});
