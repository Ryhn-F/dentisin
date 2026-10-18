import { randomUUID } from 'expo-crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * New lowercase RFC 4122 v4 UUID. Use it for every id the backend stores (child_id,
 * event_id, screening_id, brushing_id, request_id, proof_id, ...): the server stores
 * UUIDs in lower case and compares Storage paths byte for byte.
 */
export function newUuid(): string {
  return randomUUID().toLowerCase();
}

/** True for an 8-4-4-4-12 hex UUID (any case; the backend returns lower case). */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
