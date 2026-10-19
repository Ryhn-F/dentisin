import '@/core/auth/crypto-polyfill';

import { generatePKCEChallenge } from '@supabase/auth-js/dist/main/lib/helpers';

describe('crypto-polyfill', () => {
  it('defines globalThis.crypto and subtle', () => {
    expect(globalThis.crypto).toBeDefined();
    expect(typeof globalThis.crypto.getRandomValues).toBe('function');
    expect(typeof globalThis.crypto.randomUUID).toBe('function');
    expect(globalThis.crypto.subtle).toBeDefined();
    expect(typeof globalThis.crypto.subtle.digest).toBe('function');
  });

  it('getRandomValues populates Uint8Array and Uint32Array', () => {
    const u8 = new Uint8Array(16);
    globalThis.crypto.getRandomValues(u8);
    // At least one non-zero byte
    expect(Array.from(u8).some((b) => b !== 0)).toBe(true);

    const u32 = new Uint32Array(8);
    globalThis.crypto.getRandomValues(u32);
    expect(Array.from(u32).some((b) => b !== 0)).toBe(true);
  });

  it('randomUUID returns valid v4 UUID', () => {
    const uuid = globalThis.crypto.randomUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('subtle.digest computes accurate SHA-256 hash', async () => {
    const text = 'hello world';
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    // Known SHA-256 for "hello world"
    expect(hex).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('generatePKCEChallenge produces s256 challenge without warning', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = await generatePKCEChallenge(verifier);

    // Should NOT warn about WebCrypto API not supported
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('WebCrypto API is not supported')
    );
    // Challenge must be a base64url-encoded sha256 hash, NOT the raw verifier
    expect(challenge).not.toBe(verifier);
    expect(challenge.length).toBeGreaterThan(10);
    warnSpy.mockRestore();
  });
});
