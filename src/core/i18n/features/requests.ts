// Screening requests: child sends, guardian reviews (§2.5).
// UI strings only (Bahasa Indonesia); wired into `id.requests` in ../id.ts and scanned by
// __tests__/forbidden-phrases.test.ts. The child-facing part (`kidFlow`) uses grade-4 words.

export const requests = {
  title: 'Permintaan periksa',
  newTitle: 'Gigiku sakit',

  /** Child account: "Gigiku sakit" in three small steps. */
  kidFlow: {
    stepOf: (n: number, total: number) => `Langkah ${n} dari ${total}`,
    reasonTitle: 'Apa yang kamu rasakan?',
    reasonHint: 'Pilih satu gambar.',
    reasons: {
      toothache: 'Gigi sakit',
      sensitive_teeth: 'Gigi ngilu',
      bleeding_gums: 'Gusi berdarah',
      swelling: 'Pipi atau gusi bengkak',
      other: 'Yang lain',
    },
    reasonLabel: (reason: string) => `Pilih: ${reason}`,
    painIntro: 'Tunjuk seberapa sakit. Kalau kamu tidak tahu, pilih Tidak tahu.',
    flagsTitle: 'Ada yang ini juga?',
    flagsIntro: 'Jawab Ya atau Tidak.',
    flags: {
      swelling: 'Pipi atau gusi bengkak?',
      fever: 'Badan panas atau demam?',
      pus: 'Ada cairan kuning (nanah) di gusi?',
      trauma: 'Gigi terbentur atau jatuh?',
    },
    yes: 'Ya',
    no: 'Tidak',
    next: 'Lanjut',
    back: 'Kembali',
    send: 'Kirim ke orang tua',
    sendHint: 'Orang tuamu akan melihat permintaan ini.',
    /** Shown on steps 2 and 3 when the reason is already a red flag (swelling). */
    swellingNotice: 'Bengkak perlu segera diperiksa. Beri tahu orang tua sekarang.',
    /** Full-screen local advice for any red flag; never waits for the server. */
    advice: {
      title: 'Beri tahu orang tua sekarang',
      body: 'Kamu perlu segera diperiksa di puskesmas atau dokter gigi.',
    },
    privacyNote: 'Hanya apa yang kamu rasakan dan seberapa sakit yang dikirim. Jawaban Ya atau Tidak tetap di HP ini.',
    done: 'Selesai',
    status: {
      sending: 'Mengirim…',
      sent: 'Permintaan terkirim ke orang tua',
      queued: 'Akan terkirim saat ada internet',
      limit: 'Hari ini sudah banyak permintaan. Beri tahu orang tua langsung ya.',
      consent: 'Orang tua perlu menyalakan kirim data dulu. Beri tahu orang tua langsung ya.',
      syncOff: 'Minta orang tua mengaktifkan akunmu',
      failed: 'Permintaan belum bisa dikirim. Beri tahu orang tua langsung ya.',
    },
  },

  /** Guardian: list of requests from child accounts. */
  list: {
    intro: 'Anak meminta gigi atau mulutnya diperiksa. Permintaan ini bukan hasil pemeriksaan.',
    openTitle: 'Menunggu diperiksa',
    doneTitle: (n: number) => `Selesai (${n})`,
    doneToggleShow: 'Tampilkan permintaan yang sudah selesai',
    doneToggleHide: 'Sembunyikan permintaan yang sudah selesai',
    emptyTitle: 'Belum ada permintaan',
    emptyBody: 'Kalau anak meminta diperiksa dari akunnya, permintaannya muncul di sini.',
    childFallback: (n: number) => (n <= 1 ? 'Anak' : `Anak ${n}`),
    reasons: {
      toothache: 'Gigi sakit',
      sensitive_teeth: 'Gigi ngilu',
      bleeding_gums: 'Gusi berdarah',
      swelling: 'Pipi atau gusi bengkak',
      other: 'Keluhan lain',
    },
    painKnown: (n: number) => `Nyeri ${n} dari 10`,
    painUnknown: 'Tingkat nyeri tidak disebut',
    sentAt: (when: string) => `Dikirim ${when}`,
    expiresToday: 'Berlaku sampai hari ini',
    expiresIn: (days: number) => `Berlaku ${days} hari lagi`,
    statusDone: 'Sudah diperiksa',
    statusCancelled: 'Ditutup',
    statusExpired: 'Kedaluwarsa',
    statusNew: 'Baru',
    statusSeen: 'Sudah dilihat',
    urgentTag: 'Segera',
    urgentAdvice:
      'Bengkak di pipi atau gusi perlu segera diperiksa. Jangan menunggu: bawa anak ke puskesmas atau dokter gigi.',
    urgentPainAdvice: 'Anak merasakan sakit gigi yang cukup berat. Perlu diperiksa dokter gigi segera.',
    open: 'Buka detail permintaan',
    close: 'Tutup detail permintaan',
    checkNow: 'Periksa sekarang',
    checkNowHint: 'Membuka halaman skrining untuk anak ini',
    notNeeded: 'Tutup permintaan',
    confirmTitle: 'Tutup permintaan ini?',
    /** Never says the child needs no examination (forbidden_phrases.md: "tidak perlu ke dokter"). */
    confirmBody:
      'Permintaan ini hilang dari daftar menunggu. Kalau gigi atau mulut anak masih bermasalah, tetap periksakan ke puskesmas atau dokter gigi.',
    /** Swelling or severe pain: closing the request does not replace the urgent examination. */
    confirmBodyUrgent:
      'Bengkak atau sakit gigi yang berat tetap perlu segera diperiksa di puskesmas atau dokter gigi. Menutup permintaan tidak menggantikan pemeriksaan.',
    confirmYes: 'Ya, tutup',
    confirmNo: 'Kembali',
    screeningOffNote:
      'Pemeriksaan dengan foto belum aktif di versi ini. Anak tetap bisa dibawa ke puskesmas atau dokter gigi.',
    actionFailed: 'Belum berhasil. Coba lagi.',
    loading: 'Memuat permintaan…',
    refresh: 'Muat ulang',
    retry: 'Coba lagi',
    refreshFailed: 'Daftar belum bisa dimuat ulang. Data di bawah mungkin belum yang terbaru.',
    errors: {
      notDeployed: {
        title: 'Belum tersedia',
        message: 'Permintaan periksa dari anak belum tersedia di server. Coba lagi nanti.',
      },
      forbidden: {
        title: 'Tidak bisa dibuka',
        message: 'Akun ini tidak punya akses ke permintaan periksa.',
      },
      network: {
        title: 'Tidak ada sinyal',
        message: 'Permintaan butuh internet untuk dimuat. Sambungkan internet lalu coba lagi.',
      },
      notAuthenticated: {
        title: 'Masuk lagi',
        message: 'Sesi sudah berakhir. Keluar lalu masuk lagi untuk melihat permintaan.',
      },
      other: {
        title: 'Belum bisa dimuat',
        message: 'Terjadi masalah saat memuat permintaan. Coba lagi sebentar lagi.',
      },
    },
  },
} as const;
