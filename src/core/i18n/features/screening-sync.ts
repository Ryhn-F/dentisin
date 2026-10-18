// Screening results to the outbox (screening_recorded + request_id, referral_created).
// UI strings only (Bahasa Indonesia); wired into `id.screeningSync` in ../id.ts and scanned by
// __tests__/forbidden-phrases.test.ts.

export const screeningSync = {
  /** Children known only from the server have no nickname on this phone. */
  childFallback: (n: number) => (n <= 1 ? 'Anak' : `Anak ${n}`),

  /** Screening started from a child's request (requests list -> "Periksa sekarang"). */
  request: {
    title: (name: string) => `Skrining untuk permintaan ${name}`,
    body: 'Hasil skrining ini menjawab permintaan periksa dari akun anak.',
    childMissing: 'Profil anak dari permintaan ini belum ada di HP ini. Skrining tetap bisa dilakukan tanpa menjawab permintaan.',
    clear: 'Skrining biasa',
    clearHint: 'Skrining tanpa menjawab permintaan anak',
  },

  /** Teen accounts screen themselves (self profile only). */
  teen: {
    subject: 'Skrining untuk dirimu sendiri',
    note: 'Jawab pertanyaan sesuai keadaanmu sendiri.',
    noSelfTitle: 'Profil dirimu belum siap',
    noSelfBody: 'Skrining tetap bisa dipakai, tetapi hasil tidak disimpan. Buka lagi aplikasi saat ada internet.',
    ageUnknown: 'Bulan lahirmu belum diisi. Hasil foto akan dianggap belum teruji untuk usiamu.',
  },

  /** Result screen: where the saved result stands (title of the "saved" banner + this line). */
  savedTitle: 'Hasil disimpan di Riwayat (tanpa foto)',
  status: {
    pending: 'Akan dikirim ke akun saat online',
    synced: 'Tersinkron',
    localOnly: 'Tersimpan di HP saja (izin kirim data mati)',
    blocked: 'Tersimpan di HP saja (data anak ini sedang dihapus dari akun)',
    guest: 'Mode tanpa akun: hasil hanya tersimpan di HP ini',
    attention: 'Hasil belum diterima server. Lihat status kirim data di Profil.',
  },
  requestNote: 'Permintaan anak ditandai selesai setelah tersinkron',

  /** Result screen: consent (a) off, (b) on. Sent to the account, not kept on this phone. */
  sentOnly: {
    title: 'Tidak disimpan di HP ini (izin simpan mati)',
    pending: 'Hasil dikirim ke akun saat online.',
    sent: 'Hasil sudah dikirim ke akun.',
    requestNote: 'Permintaan anak ditandai selesai setelah hasil terkirim.',
  },
  /** Result screen: answered a request, but neither kept nor sent. */
  requestOpen:
    'Permintaan anak tetap terbuka karena hasil ini tidak disimpan dan tidak dikirim. Nyalakan izin simpan atau kirim data di Profil, lalu periksa lagi.',

  /** Result screen: who produced the level (ADR 019). */
  source: {
    server: 'Diperiksa di HP ini dan dicek ulang oleh server DentisAI.',
    device: 'Diperiksa di HP ini.',
    serverRejectedTitle: 'Server tidak bisa memeriksa jawaban ini',
  },
} as const;
