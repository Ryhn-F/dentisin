import type { BrushingProof } from '@/domain/models';
import {
  PAGE_SIZE,
  URL_MAX_AGE_MS,
  appendPage,
  childLabeler,
  daysUntilExpiry,
  formatMegabytes,
  isUrlFresh,
  mayHaveMore,
  nextCursor,
  playErrorKind,
  proofErrorKind,
} from '@/features/proofs/proof-flow';

function proof(idn: string, uploadedAt: string): BrushingProof {
  return {
    id: idn,
    childId: 'c1',
    brushingEventId: 'b1',
    objectPath: 'x',
    mime: 'video/mp4',
    sizeBytes: 1,
    durationS: 60,
    status: 'uploaded',
    uploadedAt,
    expiresAt: uploadedAt,
    viewedAt: null,
    objectPresent: true,
  };
}

describe('URL freshness', () => {
  it('is fresh before 280 s and stale from then on (signed URLs live 300 s)', () => {
    expect(URL_MAX_AGE_MS).toBeLessThan(300_000);
    expect(isUrlFresh(1000, 1000 + URL_MAX_AGE_MS - 1)).toBe(true);
    expect(isUrlFresh(1000, 1000 + URL_MAX_AGE_MS)).toBe(false);
    expect(isUrlFresh(null, 1000)).toBe(false);
  });
});

describe('retention and size text helpers', () => {
  const now = Date.parse('2026-10-18T10:00:00Z');
  it('rounds the days left up and floors at 0', () => {
    expect(daysUntilExpiry('2026-10-25T09:00:00Z', now)).toBe(7);
    expect(daysUntilExpiry('2026-10-18T10:30:00Z', now)).toBe(1);
    expect(daysUntilExpiry('2026-10-18T09:00:00Z', now)).toBe(0);
    expect(daysUntilExpiry('not a date', now)).toBe(0);
  });
  it('formats megabytes with a decimal comma and never shows 0', () => {
    expect(formatMegabytes(2.4 * 1024 * 1024)).toBe('2,4');
    expect(formatMegabytes(1000)).toBe('0,1');
  });
});

describe('paging', () => {
  const a = proof('a', '2026-10-18T10:00:00Z');
  const b = proof('b', '2026-10-17T10:00:00Z');
  const c = proof('c', '2026-10-16T10:00:00Z');
  it('uses the last row as the keyset cursor', () => {
    expect(nextCursor([a, b, c])).toBe(c.uploadedAt);
    expect(nextCursor([])).toBeUndefined();
  });
  it('appends without duplicating rows that repeat at the page edge', () => {
    expect(appendPage([a, b], [b, c]).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
  it('treats a full page as "maybe more" and a short page as the end', () => {
    expect(mayHaveMore(Array.from({ length: PAGE_SIZE }, (_, i) => proof(String(i), a.uploadedAt)))).toBe(true);
    expect(mayHaveMore([a])).toBe(false);
  });
});

describe('error kinds', () => {
  it('maps list codes', () => {
    expect(proofErrorKind('not_deployed')).toBe('notDeployed');
    expect(proofErrorKind('forbidden')).toBe('forbidden');
    expect(proofErrorKind('network')).toBe('network');
    expect(proofErrorKind('not_authenticated')).toBe('notAuthenticated');
    expect(proofErrorKind('bad_response')).toBe('other');
  });
  it('maps playback codes', () => {
    expect(playErrorKind('not_found')).toBe('gone');
    expect(playErrorKind('forbidden')).toBe('forbidden');
    expect(playErrorKind('network')).toBe('network');
    expect(playErrorKind('unknown')).toBe('other');
  });
});

describe('childLabeler', () => {
  const fallback = (n: number) => `Anak ${n}`;
  it('prefers the nickname, names the self profile, numbers the rest', () => {
    const label = childLabeler(
      [
        { id: 'k1', nickname: 'Dina' },
        { id: 'k2', nickname: '' },
        { id: 'k3', nickname: ' ' },
        { id: 's', nickname: '', isSelf: true },
      ],
      fallback,
      'Aku',
    );
    expect(label('k1')).toBe('Dina');
    expect(label('s')).toBe('Aku');
    expect(label('k2')).toBe('Anak 1');
    expect(label('k3')).toBe('Anak 2');
    expect(label('unknown')).toBe('Anak 1');
  });
});
