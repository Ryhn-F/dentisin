// Account gate (src/app/account-gate.tsx): signed in, but my_account() is not known yet.
// UI strings only (Bahasa Indonesia); wired into `id.accountGate` in ../id.ts and scanned by
// __tests__/forbidden-phrases.test.ts.

export const accountGate = {
  title: 'Menyiapkan akun',
  loadingTitle: 'Sebentar, ya',
  loadingBody: 'Sedang memeriksa jenis akunmu…',
  errorTitle: 'Akun belum bisa dibuka',
  errors: {
    network: 'Tidak ada koneksi internet. Sambungkan HP ke internet, lalu coba lagi.',
    sessionExpired: 'Sesi sudah berakhir. Silakan keluar, lalu masuk lagi.',
    notConfigured: 'Server belum diatur di build ini.',
    unknown: 'Ada masalah di server. Coba lagi sebentar lagi.',
  },
  keepData: 'Data yang tersimpan di HP ini tidak hilang.',
  retry: 'Coba lagi',
  signOut: 'Keluar',
} as const;
