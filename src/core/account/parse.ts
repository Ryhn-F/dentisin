// Defensive readers for backend JSON (account model v2). Every response is `unknown` until a
// reader has checked it; a mismatch throws BadResponse, which the API layer turns into the
// result code 'bad_response'. Values are never echoed into the error (no data in logs).

import { isUuid } from '@/core/util/uuid';

export class BadResponse extends Error {
  constructor(readonly field: string) {
    super(`bad_response:${field}`);
    this.name = 'BadResponse';
  }
}

export type Json = Record<string, unknown>;

export function obj(value: unknown, field = 'root'): Json {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new BadResponse(field);
  return value as Json;
}

export function arr(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new BadResponse(field);
  return value;
}

export function str(o: Json, key: string): string {
  const v = o[key];
  if (typeof v !== 'string') throw new BadResponse(key);
  return v;
}

export function strOrNull(o: Json, key: string): string | null {
  const v = o[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new BadResponse(key);
  return v;
}

export function bool(o: Json, key: string): boolean {
  const v = o[key];
  if (typeof v !== 'boolean') throw new BadResponse(key);
  return v;
}

export function boolOrNull(o: Json, key: string): boolean | null {
  const v = o[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'boolean') throw new BadResponse(key);
  return v;
}

export function int(o: Json, key: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new BadResponse(key);
  return v;
}

export function intOrNull(o: Json, key: string): number | null {
  const v = o[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new BadResponse(key);
  return v;
}

export function uuid(o: Json, key: string): string {
  const v = o[key];
  if (!isUuid(v)) throw new BadResponse(key);
  return v.toLowerCase();
}

export function uuidOrNull(o: Json, key: string): string | null {
  const v = o[key];
  if (v === null || v === undefined) return null;
  if (!isUuid(v)) throw new BadResponse(key);
  return v.toLowerCase();
}

function isTimestamp(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 64 && !Number.isNaN(Date.parse(v));
}

/** timestamptz / date as returned by PostgREST (ISO 8601 string). */
export function time(o: Json, key: string): string {
  const v = o[key];
  if (!isTimestamp(v)) throw new BadResponse(key);
  return v;
}

export function timeOrNull(o: Json, key: string): string | null {
  const v = o[key];
  if (v === null || v === undefined) return null;
  if (!isTimestamp(v)) throw new BadResponse(key);
  return v;
}

/** A string that must be one of `allowed`. */
export function oneOf<T extends string>(o: Json, key: string, allowed: readonly T[]): T {
  const v = o[key];
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw new BadResponse(key);
  return v as T;
}

export function oneOfOrNull<T extends string>(o: Json, key: string, allowed: readonly T[]): T | null {
  const v = o[key];
  if (v === null || v === undefined) return null;
  return oneOf(o, key, allowed);
}

/** Array of strings, keeping only members of `allowed` (forward compatible: unknown values drop). */
export function filterStrings<T extends string>(value: unknown, field: string, allowed: readonly T[]): T[] {
  if (value === null || value === undefined) return [];
  return arr(value, field).filter((v): v is T => typeof v === 'string' && (allowed as readonly string[]).includes(v));
}

/** Array of plain strings (codes). */
export function strings(value: unknown, field: string): string[] {
  if (value === null || value === undefined) return [];
  return arr(value, field).map((v) => {
    if (typeof v !== 'string') throw new BadResponse(field);
    return v;
  });
}
