// History timeline from child_history + brushing_streak (ACCOUNTS_AND_FLOWS.md §2.7).
// UI strings only (Bahasa Indonesia); wired into `id.timeline` in ../id.ts and scanned by
// __tests__/forbidden-phrases.test.ts. Everything under `kid` uses grade-4 words.

export const timeline = {
  title: 'Riwayat',

  segments: {
    all: 'Semua',
    brushing: 'Sikat gigi',
    screening: 'Skrining',
    requests: 'Permintaan',
    video: 'Video',
  },
  segmentsLabel: 'Pilih jenis catatan',

  /** Streak header (adult screens). */
  streak: {
    title: 'Streak sikat gigi',
    longest: (days: number) => `Terpanjang ${days} hari`,
    todayDone: 'Hari ini sudah sikat gigi.',
    keepStreak: 'Sikat gigi hari ini supaya streak tidak putus.',
    dayDone: 'sudah sikat gigi',
    dayNotYet: 'belum sikat gigi',
    forChild: (name: string) => `Streak ${name}`,
  },

  /** Children without a local nickname. */
  childFallback: (n: number) => (n <= 1 ? 'Anak' : `Anak ${n}`),
  selfLabel: 'Aku',
  childSwitcherLabel: 'Pilih anak',

  noChild: {
    title: 'Belum ada profil anak',
    body: 'Tambahkan profil anak di menu Profil. Riwayat sikat gigi dan skrining muncul di sini.',
  },

  unsynced: 'Belum sinkron',
  loading: 'Memuat riwayat…',
  refresh: 'Muat ulang',
  retry: 'Coba lagi',
  loadMore: 'Muat lagi',
  loadingMore: 'Memuat…',
  loadMoreFailed: 'Catatan berikutnya belum bisa dimuat. Coba lagi.',

  /** Small banner shown when only this phone's records are listed. */
  localOnly: {
    guest: 'Mode tanpa akun: yang tampil hanya catatan di HP ini.',
    notDeployed: 'Riwayat dari server belum tersedia. Yang tampil hanya catatan di HP ini.',
    offline: 'Riwayat dari server belum bisa dimuat. Yang tampil hanya catatan di HP ini.',
    notAllowed: 'Riwayat dari server tidak bisa dibuka untuk profil ini. Yang tampil hanya catatan di HP ini.',
    authRequired: 'Masuk lagi untuk melihat riwayat dari server. Yang tampil hanya catatan di HP ini.',
    refreshFailed: 'Riwayat belum bisa diperbarui. Data di bawah mungkin belum yang terbaru.',
  },

  empty: {
    all: { title: 'Belum ada catatan', body: 'Catatan muncul setelah sesi sikat gigi atau skrining pertama.' },
    brushing: { title: 'Belum ada catatan sikat gigi', body: 'Catatan muncul setelah sesi sikat gigi pertama.' },
    screening: { title: 'Belum ada skrining', body: 'Hasil skrining dan surat rujukan muncul di sini.' },
    requests: { title: 'Belum ada permintaan', body: 'Permintaan periksa dari anak muncul di sini.' },
    video: { title: 'Belum ada video', body: 'Video sikat gigi muncul di sini setelah dikirim dan izin video dinyalakan.' },
  },

  /** Row texts (adult screens). */
  row: {
    brushing: {
      title: { morning: 'Sikat gigi pagi', evening: 'Sikat gigi malam', other: 'Sikat gigi' },
      hasProof: 'Ada video',
      notCounted: 'Belum dihitung untuk streak',
    },
    screening: {
      title: (level: string) => `Skrining: ${level}`,
      redFlag: 'Ada tanda bahaya',
      findings: (count: number) => (count === 1 ? '1 indikasi perlu diperiksa' : `${count} indikasi perlu diperiksa`),
      answersRequest: 'Menjawab permintaan',
    },
    referral: {
      title: 'Surat rujukan',
      reasons: (count: number) => (count === 1 ? '1 alasan' : `${count} alasan`),
    },
    request: {
      title: (reason: string) => `Permintaan periksa: ${reason}`,
    },
    proof: {
      title: 'Video sikat gigi',
      expiresToday: 'Dihapus otomatis hari ini',
      expiresIn: (days: number) => `Dihapus otomatis dalam ${days} hari`,
    },
  },

  reasons: {
    toothache: 'gigi sakit',
    sensitive_teeth: 'gigi ngilu',
    bleeding_gums: 'gusi berdarah',
    swelling: 'bengkak',
    other: 'lainnya',
  },

  requestStatus: {
    pending: 'Menunggu',
    seen: 'Sudah dilihat',
    done: 'Selesai',
    cancelled: 'Dibatalkan',
    expired: 'Kedaluwarsa',
  },

  proofStatus: {
    uploaded: 'Belum ditonton',
    viewed: 'Sudah ditonton',
    deleted: 'Dihapus',
    expired: 'Kedaluwarsa',
  },

  /** Detail screen for a server item. */
  detail: {
    notFound: 'Catatan tidak ditemukan.',
    notFoundBody: 'Buka lagi dari daftar riwayat.',
    dateLabel: 'Tanggal',
    timeLabel: 'Jam',
    levelLabel: 'Tingkat',
    redFlagLabel: 'Tanda bahaya',
    redFlagYes: 'Ada',
    redFlagNo: 'Tidak ada',
    redFlagAdviceTitle: 'Segera ke puskesmas atau dokter gigi',
    redFlagAdviceBody: 'Ada tanda bahaya pada catatan ini. Jangan menunggu: periksakan secepatnya.',
    findingsLabel: 'Indikasi dari foto',
    rulesLabel: 'Versi aturan',
    notRecorded: 'Tidak tercatat',
    levelAdviceTitle: 'Anjuran',
    referralAction: 'Lihat surat rujukan',
    referralBody: 'Bawa hasil ini ke dokter gigi atau puskesmas terdekat untuk diperiksa.',
    localCopyHint: 'Rincian lengkap hasil ini hanya ada di HP yang dipakai saat skrining.',
    answersRequest: 'Menjawab permintaan periksa',

    referralReasons: 'Jumlah alasan',
    referralFacility: 'Fasilitas',
    referralFacilityNone: 'Belum dipilih',

    requestLabel: 'Permintaan periksa',
    requestReason: 'Keluhan',
    requestPain: 'Tingkat nyeri',
    requestPainValue: (level: number) => `${level} dari 10`,
    requestPainNone: 'Tidak diisi',
    requestStatus: 'Status',
    requestCreated: 'Dikirim',
    requestSeen: 'Dilihat',
    requestResponded: 'Ditanggapi',
    requestExpires: 'Berlaku sampai',
    requestNone: 'Belum',
    openRequests: 'Buka daftar permintaan',

    proofStatus: 'Status',
    proofDuration: 'Lama video',
    proofDurationValue: (seconds: number) => {
      const s = Math.max(0, Math.round(seconds));
      const m = Math.floor(s / 60);
      return m === 0 ? `${s} detik` : `${m} menit ${String(s % 60).padStart(2, '0')} detik`;
    },
    proofExpires: 'Dihapus otomatis',
    proofViewed: 'Ditonton',
    proofWatch: 'Tonton',
    proofWatchLabel: 'Tonton video sikat gigi',
    proofGone: 'Video ini sudah tidak bisa ditonton.',

    brushingDuration: 'Lama',
    brushingSlot: 'Waktu sikat',
    brushingMode: 'Mode',
    brushingModeCamera: 'Kamera',
    brushingModeTimer: 'Timer (tanpa kamera)',
    brushingHasProof: 'Video',
    brushingHasProofYes: 'Ada',
    brushingHasProofNo: 'Tidak ada',
    brushingCounts: 'Dihitung untuk streak',
    brushingCountsYes: 'Ya',
    brushingCountsNo: 'Belum',
    expiresIn: (days: number) => (days <= 0 ? 'Hari ini' : `${days} hari lagi`),
  },

  /** Child account history (/kid/history): grade-4 words, no results. */
  kid: {
    title: 'Riwayatku',
    streakTitle: 'Apiku',
    daysInARow: 'hari berturut-turut',
    longest: (days: number) => `Terpanjang ${days} hari`,
    todayDone: 'Hebat! Kamu sudah sikat gigi hari ini.',
    todayNotYet: 'Sikat gigi hari ini supaya apimu tidak padam.',
    dayDone: 'sudah sikat gigi',
    dayNotYet: 'belum sikat gigi',
    listTitle: 'Yang sudah kamu lakukan',
    loading: 'Sebentar, ya…',
    empty: 'Belum ada catatan. Yuk sikat gigi!',
    emptyTitle: 'Belum ada catatan',
    localOnly: 'Yang tampil hanya catatan di HP ini.',
    retry: 'Coba lagi',
    loadMore: 'Lihat lagi',
    loadingMore: 'Sebentar…',
    unsynced: 'Belum terkirim',
    brushing: {
      title: { morning: 'Sikat gigi pagi', evening: 'Sikat gigi malam', other: 'Sikat gigi' },
    },
    request: {
      title: (reason: string) => `Gigiku sakit: ${reason}`,
    },
    reasons: {
      toothache: 'gigi sakit',
      sensitive_teeth: 'gigi ngilu',
      bleeding_gums: 'gusi berdarah',
      swelling: 'ada yang bengkak',
      other: 'lainnya',
    },
    requestStatus: {
      pending: 'Terkirim. Menunggu orang tua.',
      seen: 'Sudah dilihat orang tua.',
      done: 'Orang tua sudah memeriksa.',
      cancelled: 'Ditutup orang tua.',
      expired: 'Sudah lewat.',
    },
    proof: {
      title: 'Video sikat gigi',
      sent: 'Video terkirim ke orang tua',
      viewed: 'Orang tua sudah menonton',
      deleted: 'Video sudah dihapus',
    },
    /** Red flag: local advice while a swelling request is listed (never waits for the server). */
    swellingTitle: 'Ada yang bengkak?',
    swellingBody: 'Beri tahu orang tuamu sekarang. Kalau bengkak, segera ke puskesmas atau dokter gigi.',
  },
} as const;
