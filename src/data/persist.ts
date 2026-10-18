// Crash-tolerant persistence on top of appStorage (Keystore-backed SecureStore, chunked).
//
// appStorage.setItem rewrites every chunk of a key, so an app kill in the middle of a write
// would leave that key unreadable. A "slot" therefore alternates between two keys (A/B) and
// only moves a small pointer key after the new copy is complete: a torn write loses at most
// the latest change, never the previous good copy.
//
// Privacy: values are personal health data. Nothing here logs keys or values.

import { appStorage, type KeyValueBackend } from '@/core/auth/secure-storage';

export type Slot = {
  /** Latest complete value, or null when nothing (readable) was stored. */
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  /** Removes both copies and the pointer. */
  remove(): Promise<void>;
};

/** A/B slot stored under `<baseKey>.a`, `<baseKey>.b` and the pointer `<baseKey>.cur`. */
export function abSlot(baseKey: string, storage: KeyValueBackend = appStorage): Slot {
  const pointerKey = `${baseKey}.cur`;
  const copyKey = (which: 'a' | 'b') => `${baseKey}.${which}`;
  let current: 'a' | 'b' | null = null;

  async function readPointer(): Promise<'a' | 'b' | null> {
    const raw = await storage.getItem(pointerKey);
    return raw === 'a' || raw === 'b' ? raw : null;
  }

  return {
    async read() {
      const pointer = await readPointer();
      current = pointer;
      if (pointer) {
        const value = await storage.getItem(copyKey(pointer));
        if (value !== null) return value;
        // Pointer moved but its copy is unreadable: fall back to the other copy.
        const other = pointer === 'a' ? 'b' : 'a';
        return storage.getItem(copyKey(other));
      }
      return null;
    },
    async write(value) {
      if (current === null) current = await readPointer();
      const next = current === 'a' ? 'b' : 'a';
      await storage.setItem(copyKey(next), value);
      await storage.setItem(pointerKey, next);
      current = next;
    },
    async remove() {
      current = null;
      await storage.removeItem(pointerKey);
      await storage.removeItem(copyKey('a'));
      await storage.removeItem(copyKey('b'));
    },
  };
}

export type Writer = {
  /** Schedules a write of `serialize()` after the debounce delay (coalesces bursts). */
  schedule(): void;
  /** Writes now if anything is scheduled or running; resolves when storage is up to date. */
  flush(): Promise<void>;
  /** Drops a scheduled write (used when the scope it belongs to is abandoned). */
  cancel(): void;
};

/**
 * Serialized, debounced writer: at most one storage write runs at a time, and a change made
 * while a write is running triggers exactly one more write with the latest value. Write
 * failures are swallowed (the in-memory state stays authoritative for this run).
 */
export function createWriter(slot: Slot, serialize: () => string, debounceMs: number): Writer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let dirty = false;

  async function runWrites() {
    while (dirty) {
      dirty = false;
      try {
        await slot.write(serialize());
      } catch {
        // Keystore unavailable: keep going in memory; the next change retries.
      }
    }
  }

  function start(): Promise<void> {
    if (!running) {
      running = runWrites().finally(() => {
        running = null;
      });
    }
    return running;
  }

  return {
    schedule() {
      dirty = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void start();
      }, debounceMs);
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      // A running write may finish before the latest change: loop until nothing is dirty.
      while (running || dirty) {
        await start();
      }
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      dirty = false;
    },
  };
}
