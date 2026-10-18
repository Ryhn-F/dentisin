import { useAccount } from '@/core/account/account-store';
import type { WaitResult } from '@/core/sync/outbox';
import { triageParams } from '@/domain/triage';
import {
  childLabeler,
  daysUntilExpiry,
  groupByChild,
  PAIN_URGENT_MIN_SCORE,
  hasRedFlag,
  isSeverePain,
  listErrorKind,
  needsLocalAdvice,
  outcomeFromWait,
  outcomeWhenNotQueued,
  painToLevel,
  requestUrgency,
  sendRequest,
  visibleRedFlags,
  type RequestOutcome,
} from '@/features/requests/request-flow';

const mockRecord = jest.fn();
const mockWait = jest.fn();
const mockFlush = jest.fn();
const mockDismiss = jest.fn();

jest.mock('@/core/sync/bridge', () => ({ recordScreeningRequest: (...a: unknown[]) => mockRecord(...a) }));
jest.mock('@/core/sync/outbox', () => ({
  outbox: {
    flush: (...a: unknown[]) => mockFlush(...a),
    waitForEvent: (...a: unknown[]) => mockWait(...a),
    dismiss: (...a: unknown[]) => mockDismiss(...a),
  },
}));

const childAccount = (syncAllowed: boolean) =>
  ({
    childAccount: { childId: 'c', guardianId: 'g', username: 'u', disabled: false, syncAllowed, proofAllowed: true },
  }) as never;

const tick = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  mockRecord.mockReset();
  mockWait.mockReset();
  mockFlush.mockReset().mockResolvedValue({});
  mockDismiss.mockReset();
  useAccount.setState({ me: null });
});

describe('red flags', () => {
  it('any yes answer is a red flag; all no is not', () => {
    expect(hasRedFlag('toothache', {})).toBe(false);
    expect(hasRedFlag('toothache', { fever: false, pus: false })).toBe(false);
    expect(hasRedFlag('toothache', { fever: true })).toBe(true);
    expect(hasRedFlag('other', { trauma: true })).toBe(true);
  });

  it('the swelling reason is a red flag by itself and skips the bengkak question', () => {
    expect(hasRedFlag('swelling', {})).toBe(true);
    expect(visibleRedFlags('swelling')).toEqual(['fever', 'pus', 'trauma']);
    expect(visibleRedFlags('toothache')).toEqual(['swelling', 'fever', 'pus', 'trauma']);
  });

  it('severe pain uses the bundled rules pain_urgent_min_score (PAIN_HIGH), never a number of its own', () => {
    expect(PAIN_URGENT_MIN_SCORE).toBe(Number(triageParams.pain_urgent_min_score));
    expect(isSeverePain(PAIN_URGENT_MIN_SCORE)).toBe(true);
    expect(isSeverePain(10)).toBe(true);
    expect(isSeverePain('unknown')).toBe(false);
    expect(isSeverePain(null)).toBe(false);
    expect(isSeverePain(6, 7)).toBe(false);
    expect(isSeverePain(7, 7)).toBe(true);
  });

  it('local advice: red flag or severe pain; "tidak tahu" alone never', () => {
    expect(needsLocalAdvice('toothache', { swelling: false, fever: false, pus: false, trauma: false }, 10)).toBe(true);
    expect(needsLocalAdvice('toothache', {}, 'unknown')).toBe(false);
    expect(needsLocalAdvice('other', { pus: true }, 'unknown')).toBe(true);
    expect(needsLocalAdvice('swelling', {}, null)).toBe(true);
  });

  it('guardian urgency: swelling first, then severe pain', () => {
    expect(requestUrgency('swelling', null)).toBe('swelling');
    expect(requestUrgency('swelling', 10)).toBe('swelling');
    expect(requestUrgency('toothache', 10)).toBe('pain');
    expect(requestUrgency('toothache', null)).toBeNull();
  });

  it('"tidak tahu" pain is null, never 0', () => {
    expect(painToLevel('unknown')).toBeNull();
    expect(painToLevel(null)).toBeNull();
    expect(painToLevel(0)).toBe(0);
    expect(painToLevel(7)).toBe(7);
  });
});

describe('request status mapping', () => {
  const cases = [
    [{ state: 'applied' }, 'sent'],
    [{ state: 'timeout' }, 'queued'],
    [{ state: 'rejected', code: 'limit_exceeded' }, 'limit'],
    [{ state: 'rejected', code: 'consent_required' }, 'consent'],
    [{ state: 'rejected', code: 'schema_invalid' }, 'failed'],
    [{ state: 'unknown' }, 'failed'],
  ] as unknown as [WaitResult, RequestOutcome][];

  it.each(cases)('%j -> %s', (result, outcome) => {
    expect(outcomeFromWait(result)).toBe(outcome);
  });

  it('a bridge refusal is syncOff only when the parent has not allowed sending', () => {
    expect(outcomeWhenNotQueued()).toBe('failed');
    useAccount.setState({ me: childAccount(false) });
    expect(outcomeWhenNotQueued()).toBe('syncOff');
  });
});

describe('sendRequest', () => {
  it('sends only reason_code and pain level through the bridge', async () => {
    mockRecord.mockReturnValue('evt-1');
    mockWait.mockResolvedValue({ state: 'applied' });
    const seen: RequestOutcome[] = [];
    sendRequest({ childId: 'child-1', reason: 'toothache', painLevel: null }, (o) => seen.push(o));
    await tick();
    expect(mockRecord).toHaveBeenCalledWith({ childId: 'child-1', reasonCode: 'toothache', painLevel: null });
    expect(seen).toEqual(['sending', 'sent']);
  });

  it('reports syncOff when nothing was queued', () => {
    useAccount.setState({ me: childAccount(false) });
    mockRecord.mockReturnValue(null);
    const seen: RequestOutcome[] = [];
    sendRequest({ childId: 'c', reason: 'other', painLevel: 3 }, (o) => seen.push(o));
    expect(seen).toEqual(['syncOff']);
    expect(mockWait).not.toHaveBeenCalled();
  });

  it('keeps waiting while queued, then dismisses a refused request', async () => {
    mockRecord.mockReturnValue('evt-2');
    mockWait
      .mockResolvedValueOnce({ state: 'timeout' })
      .mockResolvedValueOnce({ state: 'rejected', code: 'limit_exceeded' });
    const seen: RequestOutcome[] = [];
    sendRequest({ childId: 'c', reason: 'other', painLevel: 1 }, (o) => seen.push(o));
    await tick();
    await tick();
    expect(seen).toEqual(['sending', 'queued', 'limit']);
    expect(mockDismiss).toHaveBeenCalledWith('evt-2');
  });

  it('stops reporting after cancel', async () => {
    mockRecord.mockReturnValue('evt-3');
    let resolve: (r: WaitResult) => void = () => {};
    mockWait.mockReturnValue(new Promise<WaitResult>((r) => (resolve = r)));
    const seen: RequestOutcome[] = [];
    const cancel = sendRequest({ childId: 'c', reason: 'other', painLevel: 1 }, (o) => seen.push(o));
    cancel();
    resolve({ state: 'applied' } as WaitResult);
    await tick();
    expect(seen).toEqual(['sending']);
  });
});

describe('guardian list helpers', () => {
  it('maps API codes to friendly error kinds', () => {
    expect(listErrorKind('not_deployed')).toBe('notDeployed');
    expect(listErrorKind('forbidden')).toBe('forbidden');
    expect(listErrorKind('network')).toBe('network');
    expect(listErrorKind('internal')).toBe('other');
  });

  it('counts expiry days rounded up and never negative', () => {
    const now = Date.parse('2026-10-18T10:00:00Z');
    expect(daysUntilExpiry('2026-10-18T12:00:00Z', now)).toBe(1);
    expect(daysUntilExpiry('2026-10-21T10:00:00Z', now)).toBe(3);
    expect(daysUntilExpiry('2026-10-17T10:00:00Z', now)).toBe(0);
    expect(daysUntilExpiry('garbage', now)).toBe(0);
  });

  it('groups by child in order of first appearance', () => {
    const groups = groupByChild([
      { childId: 'a', n: 1 },
      { childId: 'b', n: 2 },
      { childId: 'a', n: 3 },
    ]);
    expect(groups.map((g) => [g.childId, g.items.length])).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
  });

  it('labels unnamed children, numbering only when there are several', () => {
    const fallback = (n: number) => (n <= 1 ? 'Anak' : `Anak ${n}`);
    const kids = [{ id: 'a', nickname: 'Budi' }];
    expect(childLabeler(kids, ['a', 'b'], fallback)('a')).toBe('Budi');
    expect(childLabeler(kids, ['a', 'b'], fallback)('b')).toBe('Anak');
    const label = childLabeler(kids, ['b', 'c'], fallback);
    expect([label('b'), label('c')]).toEqual(['Anak', 'Anak 2']);
  });
});
