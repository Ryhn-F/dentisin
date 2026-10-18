// Request loop (ACCOUNTS_AND_FLOWS.md §2.5): a guardian with consent (b) on but (a) off who
// answers a child's request still sends screening_recorded (+ request_id), without keeping the
// result on this phone; the result screen says so, and says when a request stays open.
import { act, render, screen } from '@testing-library/react-native';
import { createElement, type ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import Result from '@/app/screening/result';
import { useAccount } from '@/core/account/account-store';
import { setStorageBackendForTests, type KeyValueBackend } from '@/core/auth/secure-storage';
import { useSession } from '@/core/auth/session-store';
import { id } from '@/core/i18n/id';
import { installSyncBridge, reconcile, syncRefs } from '@/core/sync/bridge';
import { outbox } from '@/core/sync/outbox';
import { useLocalData } from '@/data/local-store';
import { DEFAULT_LIMITS, type ChildProfile, type MyAccount } from '@/domain/models';
import { triageRules, type Answer } from '@/domain/triage';
import { useScreeningSession } from '@/features/screening/session-store';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn(), dismissTo: jest.fn(), setParams: jest.fn() },
  useLocalSearchParams: () => ({}),
  useFocusEffect: jest.fn(),
}));
jest.mock('@/core/flags', () => ({
  ...jest.requireActual('@/core/flags'),
  flags: { medical_modules: true, dataset_contribution: false },
}));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('@/core/auth/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    auth: { refreshSession: jest.fn(), signOut: jest.fn(), getSession: jest.fn(), onAuthStateChange: jest.fn() },
  },
}));

type WireEvent = { event_id: string; type: string; payload: Record<string, unknown> };
const rpc = (jest.requireMock('@/core/auth/supabase') as { supabase: { rpc: jest.Mock } }).supabase.rpc;

const GUARDIAN = '0b0b0b0b-0000-4000-8000-000000000001';
const CHILD = 'c0c0c0c0-0000-4000-8000-000000000001';
const REQUEST = '77777777-7777-4777-8777-777777777701';
const ts = id.screeningSync;

function memoryBackend(): KeyValueBackend {
  const store = new Map<string, string>();
  return {
    getItem: async (k) => store.get(k) ?? null,
    setItem: async (k, v) => void store.set(k, v),
    removeItem: async (k) => void store.delete(k),
  };
}

const guardian: MyAccount = {
  userId: GUARDIAN,
  accountType: 'guardian',
  roles: ['guardian'],
  selfChildId: null,
  childAccounts: 0,
  childAccount: null,
  flags: { brushingProofVideo: false },
  capabilities: { createChildAccounts: true, registerProofs: false },
  limits: DEFAULT_LIMITS,
};

const kid = (): ChildProfile => ({ id: CHILD, nickname: 'Adik', birthYear: 2018, birthMonth: 3, allergies: [] });
const l = () => useLocalData.getState();
const session = () => useScreeningSession.getState();
const screeningEntries = () =>
  [...outbox.refs()].filter((ref) => ref.startsWith('screening:')).flatMap((ref) => outbox.findByRef(ref));

const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
const wrap = (ui: ReactElement) => createElement(SafeAreaProvider, { initialMetrics: metrics }, ui);

function serverApplies(decide: (e: WireEvent) => { status: string; code?: string } = () => ({ status: 'applied' })) {
  rpc.mockImplementation(async (_fn: string, args: { batch: WireEvent[] }) => ({
    data: args.batch.map((e, i) => ({ index: i, event_id: e.event_id, ...decide(e) })),
    error: null,
    status: 200,
  }));
}

async function signIn() {
  useSession.setState({ status: 'signedIn', userId: GUARDIAN, email: null });
  useAccount.setState({ userId: GUARDIAN, me: guardian, status: 'ready', lastError: null });
  await Promise.all([l().setScope(GUARDIAN), outbox.setScope(GUARDIAN)]);
  l().applyAccount(guardian);
}

/** Guardian with one child; consent (a) / (b) as given. */
async function guardianWith(consents: { a: boolean; b: boolean }) {
  await signIn();
  l().upsertChild(kid());
  if (consents.a) l().setConsent(CHILD, 'a', true);
  if (consents.b) l().setConsent(CHILD, 'b', true);
}

async function screenFor(requestId: string | null) {
  const child = l().kids.find((k) => k.id === CHILD) ?? null;
  session().start(child, undefined, { requestId });
  for (const q of triageRules.questions) session().setAnswer(q.id, 'no' as Answer);
  session().setPain(0);
  return session().finish('skip');
}

let uninstall: () => void = () => {};

beforeEach(async () => {
  // Fake timers keep the outbox's debounced auto-flush from firing; tests flush explicitly.
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
  await Promise.all([l().setScope(null), outbox.setScope(null)]);
  setStorageBackendForTests(memoryBackend());
  useSession.setState({ status: 'signedOut', userId: null, email: null });
  useAccount.setState({ userId: null, me: null, status: 'idle', lastError: null });
  rpc.mockReset();
  session().reset();
  uninstall = installSyncBridge();
});

afterEach(() => {
  uninstall();
  jest.useRealTimers();
});

describe('session: consent (a) off, (b) on', () => {
  it('sends screening_recorded with request_id without keeping the result', async () => {
    await guardianWith({ a: false, b: true });
    const outcome = await screenFor(REQUEST);
    expect(outcome.kind).toBe('result');
    const s = session();
    expect(s.saveState).toBe('sent_only');
    expect(s.record).toBeNull();
    expect(s.sentEventId).toEqual(expect.any(String));
    expect(l().screenings).toEqual([]);

    const [entry] = screeningEntries();
    expect(screeningEntries()).toHaveLength(1);
    expect(entry.eventId).toBe(s.sentEventId);
    expect(entry.childId).toBe(CHILD);
    const payload = JSON.parse(entry.payloadJson) as Record<string, unknown>;
    expect(payload).toMatchObject({ child_id: CHILD, request_id: REQUEST, level: expect.any(String) });
    // Depends on the queued (b) grant, like a kept record.
    expect(entry.dependsOn).toEqual(expect.arrayContaining(outbox.findByRef(syncRefs.consent(CHILD, 'b', 'grant')).map((e) => e.eventId)));
  });

  it('without a request: still sent, no request_id', async () => {
    await guardianWith({ a: false, b: true });
    await screenFor(null);
    expect(session().saveState).toBe('sent_only');
    const payload = JSON.parse(screeningEntries()[0].payloadJson) as Record<string, unknown>;
    expect(payload.request_id).toBeUndefined();
  });

  it('reconcile never re-queues it, before or after it is applied', async () => {
    await guardianWith({ a: false, b: true });
    await screenFor(REQUEST);
    const ref = screeningEntries()[0].ref!;
    reconcile();
    expect(outbox.findByRef(ref)).toHaveLength(1);

    serverApplies();
    await outbox.flush();
    expect(outbox.getEventState(session().sentEventId!)).toBe('applied');
    expect(outbox.findByRef(ref)).toHaveLength(0);
    expect(reconcile()).toBe(0);
    expect(outbox.findByRef(ref)).toHaveLength(0);
    // markSynced for a record outside the store is a no-op; nothing was kept.
    expect(l().screenings).toEqual([]);
  });

  it('tolerates a rejection and an entity_conflict for a record outside the store', async () => {
    await guardianWith({ a: false, b: true });
    await screenFor(REQUEST);
    serverApplies((e) => (e.type === 'screening_recorded' ? { status: 'rejected', code: 'entity_conflict' } : { status: 'applied' }));
    await expect(outbox.flush()).resolves.toBeDefined();
    expect(screeningEntries()).toHaveLength(0);
    expect(l().screenings).toEqual([]);
    expect(reconcile()).toBe(0);
  });

  it('a (b) withdrawal before sending purges it', async () => {
    await guardianWith({ a: false, b: true });
    await screenFor(REQUEST);
    l().setConsent(CHILD, 'b', false);
    expect(screeningEntries()).toHaveLength(0);
  });
});

describe('session: other consent combinations', () => {
  it('(a) on: kept and sent as before', async () => {
    await guardianWith({ a: true, b: true });
    await screenFor(REQUEST);
    const s = session();
    expect(s.saveState).toBe('saved');
    expect(s.sentEventId).toBeNull();
    expect(l().screenings).toHaveLength(1);
    expect(JSON.parse(screeningEntries()[0].payloadJson)).toMatchObject({ request_id: REQUEST });
  });

  it('neither (a) nor (b): nothing kept, nothing sent', async () => {
    await guardianWith({ a: false, b: false });
    await screenFor(REQUEST);
    expect(session()).toMatchObject({ saveState: 'no_consent', record: null, sentEventId: null });
    expect(screeningEntries()).toHaveLength(0);
  });

  it('guest mode: nothing sent', async () => {
    useSession.setState({ status: 'guest', userId: null, email: null });
    l().upsertChild(kid());
    await screenFor(null);
    expect(session()).toMatchObject({ saveState: 'no_consent', sentEventId: null });
  });
});

describe('result screen', () => {
  it('sent only: says it is not kept, sent to the account, and the request closes once sent', async () => {
    await guardianWith({ a: false, b: true });
    await screenFor(REQUEST);
    await render(wrap(createElement(Result)));
    expect(screen.getByTestId('save-state-sent_only')).toBeOnTheScreen();
    expect(screen.getByText(ts.sentOnly.title)).toBeOnTheScreen();
    expect(screen.getByText(ts.sentOnly.pending)).toBeOnTheScreen();
    expect(screen.getByText(ts.sentOnly.requestNote)).toBeOnTheScreen();
    expect(screen.queryByText(id.screening.result.notSavedNoConsent)).toBeNull();

    serverApplies();
    await act(async () => {
      await outbox.flush();
    });
    expect(screen.getByText(ts.sentOnly.sent)).toBeOnTheScreen();
  });

  it('sent only without a request: no request note', async () => {
    await guardianWith({ a: false, b: true });
    await screenFor(null);
    await render(wrap(createElement(Result)));
    expect(screen.getByText(ts.sentOnly.title)).toBeOnTheScreen();
    expect(screen.queryByTestId('save-state-request')).toBeNull();
  });

  it('neither kept nor sent: tells the guardian the request stays open', async () => {
    await guardianWith({ a: false, b: false });
    await screenFor(REQUEST);
    await render(wrap(createElement(Result)));
    expect(screen.getByText(id.screening.result.notSavedNoConsent)).toBeOnTheScreen();
    expect(screen.getByText(ts.requestOpen)).toBeOnTheScreen();
  });

  it('neither kept nor sent, no request: no request line', async () => {
    await guardianWith({ a: false, b: false });
    await screenFor(null);
    await render(wrap(createElement(Result)));
    expect(screen.getByText(id.screening.result.notSavedNoConsent)).toBeOnTheScreen();
    expect(screen.queryByTestId('save-state-request-open')).toBeNull();
  });
});
