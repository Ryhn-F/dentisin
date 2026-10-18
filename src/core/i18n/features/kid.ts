// Child-account screens (/kid): grade-4 wording, no results, no settings.
// UI strings only (Bahasa Indonesia); wired into `id.kid` in ../id.ts and scanned by
// __tests__/forbidden-phrases.test.ts.

export const kid = {
  title: 'Beranda',
  tabs: {
    home: 'Beranda',
    history: 'Riwayat',
    account: 'Akun',
  },
  accountTitle: 'Akunku',
  signOut: 'Keluar',

  home: {
    hello: (name: string) => `Halo, ${name}!`,
    helloNoName: 'Halo!',
    intro: 'Yuk sikat gigi dan jaga gigimu.',
    streakTitle: 'Apiku',
    todayDone: 'Hebat! Kamu sudah sikat gigi hari ini.',
    todayNotYet: 'Sikat gigi hari ini supaya apimu tidak padam.',
    dayDone: 'sudah sikat gigi',
    dayNotYet: 'belum sikat gigi',
    brushNow: 'Sikat gigi sekarang',
    brushNowHint: 'Mulai sikat gigi 2 menit',
    toothache: 'Gigiku sakit',
    toothacheHint: 'Beri tahu orang tua supaya gigimu diperiksa',
    proofHint: 'Kalau kamu merekam video sikat gigi, hanya orang tuamu yang bisa melihatnya.',
    syncOffTitle: 'Minta orang tua mengaktifkan akunmu',
    syncOffBody: 'Sikat gigimu tetap tercatat di HP ini.',
    loading: 'Sebentar, ya…',
  },

  /** "Permintaanmu": the child's own screening requests, status only. */
  requests: {
    title: 'Permintaanmu',
    empty: 'Belum ada permintaan.',
    unavailable: 'Daftar ini belum tersedia.',
    error: 'Daftar belum bisa dibuka. Coba lagi nanti.',
    reasons: {
      toothache: 'Gigi sakit',
      sensitive_teeth: 'Gigi ngilu',
      bleeding_gums: 'Gusi berdarah',
      swelling: 'Ada yang bengkak',
      other: 'Lainnya',
    },
    statuses: {
      pending: 'Terkirim. Menunggu orang tua.',
      seen: 'Sudah dilihat orang tua.',
      done: 'Orang tua sudah memeriksa.',
      cancelled: 'Ditutup orang tua.',
      expired: 'Sudah lewat.',
    },
    rowLabel: (reason: string, status: string, date: string) => `${reason}. ${status} ${date}`,
    /** Red flag: shown locally while a swelling request is open (never waits for the server). */
    swellingTitle: 'Ada yang bengkak?',
    swellingBody: 'Beri tahu orang tuamu sekarang. Kalau bengkak, segera ke puskesmas atau dokter gigi.',
  },

  account: {
    usernameLabel: 'Nama pengguna',
    forgotTitle: 'Lupa kata sandi?',
    forgotBody: 'Minta orang tuamu membuat kata sandi baru.',
    confirmTitle: 'Mau keluar?',
    confirmBody: 'Untuk masuk lagi, kamu perlu email orang tua, nama pengguna, dan kata sandimu.',
    confirmYes: 'Ya, keluar',
    confirmNo: 'Tidak jadi',
  },
} as const;
