// App-owned copy of docs/style/forbidden_phrases.md (ADR 010, same pattern as ADR 009 §4).
// The parity test fails if the shared doc gains a phrase that is missing here.
// Matching is case-insensitive and word-bounded ("aman" does not match "keamanan").

export const forbiddenPhrases: readonly string[] = [
  'anda menderita',
  'anak anda menderita',
  'diagnosis',
  'didiagnosis',
  'terdiagnosis',
  'pasti',
  'dipastikan',
  '100%',
  'positif karies',
  'negatif karies',
  'tidak perlu ke dokter',
  'aman',
  'sehat sempurna',
  'bebas karies',
  'obati sendiri',
  'akurasi',
];

// Mandatory wording that contains an otherwise-forbidden word.
export const allowedPhrases: readonly string[] = ['bukan diagnosis'];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findForbidden(text: string): string[] {
  let haystack = text.toLowerCase();
  for (const allowed of allowedPhrases) {
    haystack = haystack.split(allowed).join(' ');
  }
  return forbiddenPhrases.filter((phrase) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}])`, 'u').test(haystack),
  );
}
