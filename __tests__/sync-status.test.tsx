// SyncStatusPill state derived from the session and the outbox (src/core/sync/use-sync-status.ts).
import { render, screen } from '@testing-library/react-native';

import { SyncStatusPill } from '@/components/sync-status-pill';
import { id } from '@/core/i18n/id';
import type { OutboxStatus } from '@/core/sync/outbox';
import { deriveSyncStatus, rejectionMessage, syncMessage } from '@/core/sync/use-sync-status';

jest.mock('@/core/auth/supabase', () => ({
  supabase: { rpc: jest.fn(), auth: { refreshSession: jest.fn(), signOut: jest.fn(), getSession: jest.fn(), onAuthStateChange: jest.fn() } },
}));

const idle: OutboxStatus = {
  scope: 'u',
  ready: true,
  syncing: false,
  pending: 0,
  held: 0,
  rejected: 0,
  pauseReason: null,
  backoffReason: null,
  nextAttemptAt: null,
  lastSuccessAt: null,
};

describe('deriveSyncStatus', () => {
  it('guest and signed-out data is local only', () => {
    expect(deriveSyncStatus('guest', idle)).toBe('local');
    expect(deriveSyncStatus('signedOut', idle)).toBe('local');
  });

  it('signed in: synced, pending, offline, attention', () => {
    expect(deriveSyncStatus('signedIn', idle)).toBe('synced');
    expect(deriveSyncStatus('signedIn', { ...idle, ready: false })).toBe('pending');
    expect(deriveSyncStatus('signedIn', { ...idle, pending: 2 })).toBe('pending');
    expect(deriveSyncStatus('signedIn', { ...idle, pending: 2, backoffReason: 'server' })).toBe('pending');
    expect(deriveSyncStatus('signedIn', { ...idle, pending: 2, pauseReason: 'unavailable' })).toBe('pending');
    expect(deriveSyncStatus('signedIn', { ...idle, pending: 2, backoffReason: 'network' })).toBe('offline');
    expect(deriveSyncStatus('signedIn', { ...idle, rejected: 1 })).toBe('attention');
    expect(deriveSyncStatus('signedIn', { ...idle, held: 1 })).toBe('attention');
    expect(deriveSyncStatus('signedIn', { ...idle, pending: 1, pauseReason: 'auth_required' })).toBe('attention');
  });
});

describe('messages', () => {
  it('explains the state in one line', () => {
    expect(syncMessage('guest', idle)).toBe(id.syncV2.messages.localOnly);
    expect(syncMessage('signedIn', idle)).toBeNull();
    expect(syncMessage('signedIn', { ...idle, pending: 1, backoffReason: 'network' })).toBe(id.syncV2.messages.offline);
    expect(syncMessage('signedIn', { ...idle, pending: 1, pauseReason: 'unavailable' })).toBe(id.syncV2.messages.unavailable);
    expect(syncMessage('signedIn', { ...idle, pauseReason: 'auth_required' })).toBe(id.syncV2.messages.authRequired);
    expect(syncMessage('signedIn', { ...idle, rejected: 2 })).toBe(id.syncV2.messages.needsAttention);
  });

  it('maps rejection codes, unknown ones to a generic text', () => {
    expect(rejectionMessage('limit_exceeded')).toBe(id.syncV2.codes.limit_exceeded);
    expect(rejectionMessage('dependency_rejected')).toBe(id.syncV2.codes.dependency_rejected);
    expect(rejectionMessage('brand_new_code')).toBe(id.syncV2.codes.unknown);
    expect(rejectionMessage(null)).toBe(id.syncV2.codes.unknown);
  });
});

describe('SyncStatusPill', () => {
  it('has a word for the attention state', async () => {
    await render(<SyncStatusPill status="attention" />);
    expect(screen.getByLabelText(id.syncV2.status.attention)).toBeOnTheScreen();
  });
});
