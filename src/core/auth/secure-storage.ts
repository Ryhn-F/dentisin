import * as SecureStore from 'expo-secure-store';

// Supabase session storage backed by the Android Keystore (expo-secure-store).
// SecureStore values are size-limited, so values are split into chunks.
// Web (preview only) falls back to localStorage.

export type KeyValueBackend = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

const CHUNK_SIZE = 1800;

// SecureStore keys allow only [A-Za-z0-9._-].
export function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

const secureStoreBackend: KeyValueBackend = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

const webBackend: KeyValueBackend = {
  getItem: async (key) => globalThis.localStorage?.getItem(key) ?? null,
  setItem: async (key, value) => globalThis.localStorage?.setItem(key, value),
  removeItem: async (key) => globalThis.localStorage?.removeItem(key),
};

export function createChunkedStorage(backend: KeyValueBackend): KeyValueBackend {
  const countKey = (key: string) => `${safeKey(key)}.n`;
  const chunkKey = (key: string, i: number) => `${safeKey(key)}.${i}`;

  async function removeItem(key: string) {
    const n = Number(await backend.getItem(countKey(key))) || 0;
    for (let i = 0; i < n; i++) await backend.removeItem(chunkKey(key, i));
    await backend.removeItem(countKey(key));
  }

  return {
    async getItem(key) {
      const raw = await backend.getItem(countKey(key));
      if (raw === null) return null;
      const n = Number(raw);
      const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        const part = await backend.getItem(chunkKey(key, i));
        if (part === null) return null; // partial write: treat as missing
        parts.push(part);
      }
      return parts.join('');
    },
    async setItem(key, value) {
      await removeItem(key);
      const n = Math.max(1, Math.ceil(value.length / CHUNK_SIZE));
      for (let i = 0; i < n; i++) {
        await backend.setItem(chunkKey(key, i), value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
      }
      await backend.setItem(countKey(key), String(n));
    },
    removeItem,
  };
}

let backendOverride: KeyValueBackend | null = null;

/** Test hook: replace the platform backend (e.g. with an in-memory map). */
export function setStorageBackendForTests(backend: KeyValueBackend | null) {
  backendOverride = backend;
}

function platformBackend(): KeyValueBackend {
  if (backendOverride) return backendOverride;
  return process.env.EXPO_OS === 'web' ? webBackend : secureStoreBackend;
}

// Lazily resolved so tests can swap the backend before first use.
export const appStorage: KeyValueBackend = {
  getItem: (key) => createChunkedStorage(platformBackend()).getItem(key),
  setItem: (key, value) => createChunkedStorage(platformBackend()).setItem(key, value),
  removeItem: (key) => createChunkedStorage(platformBackend()).removeItem(key),
};
