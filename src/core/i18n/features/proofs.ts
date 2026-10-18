// Proof list + player (guardian: children; teen: own videos), retention, delete (§2.6, §2.8).
// UI strings only (Bahasa Indonesia); wired into `id.proofs` in ../id.ts and scanned by
// __tests__/forbidden-phrases.test.ts.

export const proofs = {
  title: 'Video sikat gigi',
  playerTitle: 'Putar video',

  list: {
    /** Who can see the clips, retention, and that they never train a model. */
    privacyGuardian: (days: number) =>
      `Video ini hanya bisa dilihat oleh orang tua. Video tidak dipakai untuk melatih model, dan dihapus otomatis ${days} hari setelah dikirim.`,
    privacyTeen: (days: number) =>
      `Video ini hanya bisa kamu lihat sendiri. Video tidak dipakai untuk melatih model, dan dihapus otomatis ${days} hari setelah dikirim.`,
    childPicker: 'Pilih anak',
    childFallback: (n: number) => (n <= 1 ? 'Anak' : `Anak ${n}`),
    selfFallback: 'Aku',
    forChild: (name: string) => `Video milik ${name}`,
    loading: 'Memuat video…',
    refresh: 'Muat ulang',
    retry: 'Coba lagi',
    refreshFailed: 'Daftar belum bisa dimuat ulang. Data di bawah mungkin belum yang terbaru.',
    emptyTitle: 'Belum ada video',
    emptyGuardian: 'Video muncul di sini setelah anak mengirimnya dan izin video sikat gigi dinyalakan.',
    emptyTeen: 'Video muncul di sini setelah kamu merekam sikat gigi dan izin video dinyalakan.',
    noChildTitle: 'Belum ada anak',
    noChildBody: 'Tambahkan profil anak dulu. Video sikat gigi anak muncul di sini.',
    isNew: 'Baru',
    notUploaded: 'Belum selesai diunggah',
    notUploadedHint: 'Video ini belum bisa diputar.',
    duration: (seconds: number) => {
      const s = Math.max(0, Math.round(seconds));
      const m = Math.floor(s / 60);
      const rest = s % 60;
      return m === 0 ? `${rest} detik` : `${m} menit ${String(rest).padStart(2, '0')} detik`;
    },
    size: (megabytes: string) => `${megabytes} MB`,
    expiresToday: 'Dihapus otomatis hari ini',
    expiresIn: (days: number) => `Dihapus otomatis dalam ${days} hari`,
    play: 'Putar video',
    rowLabel: (when: string, duration: string, isNew: boolean) =>
      `Video sikat gigi ${when}, ${duration}${isNew ? ', belum ditonton' : ''}`,
    delete: 'Hapus video',
    deleteLabel: (when: string) => `Hapus video ${when}`,
    deleteTitle: 'Hapus video ini?',
    deleteBody: 'Video langsung disembunyikan dan tidak bisa dikembalikan.',
    deleteYes: 'Ya, hapus',
    deleteNo: 'Jangan hapus',
    deleteFailed: 'Video belum berhasil dihapus. Coba lagi.',
    loadMore: 'Muat lagi',
    loadingMore: 'Memuat…',
    loadMoreFailed: 'Video berikutnya belum bisa dimuat.',
    errors: {
      notDeployed: {
        title: 'Belum tersedia',
        message: 'Video sikat gigi belum tersedia di server. Coba lagi nanti.',
      },
      forbidden: {
        title: 'Tidak bisa dibuka',
        message: 'Akun ini tidak punya akses ke video ini.',
      },
      network: {
        title: 'Tidak ada sinyal',
        message: 'Video butuh internet untuk dimuat. Sambungkan internet lalu coba lagi.',
      },
      notAuthenticated: {
        title: 'Masuk lagi',
        message: 'Sesi sudah berakhir. Keluar lalu masuk lagi untuk melihat video.',
      },
      other: {
        title: 'Belum bisa dimuat',
        message: 'Terjadi masalah saat memuat video. Coba lagi sebentar lagi.',
      },
    },
  },

  player: {
    loading: 'Memuat video…',
    cover: 'Video sikat gigi',
    play: 'Putar video',
    playHint: 'Memuat video lalu memutarnya',
    replay: 'Putar lagi',
    preparing: 'Menyiapkan video…',
    videoLabel: 'Pemutar video sikat gigi',
    when: (when: string) => `Direkam ${when}`,
    notFoundTitle: 'Video tidak ditemukan',
    notFoundBody: 'Video ini sudah dihapus atau masa simpannya habis.',
    backToList: 'Kembali ke daftar',
    notUploadedTitle: 'Belum selesai diunggah',
    notUploadedBody: 'Video ini belum bisa diputar. Coba lagi nanti.',
    privacy: 'Video ini tidak bisa diunduh atau dibagikan, dan tidak dipakai untuk melatih model.',
    deletedNote: 'Video dihapus.',
    errors: {
      gone: {
        title: 'Video sudah tidak ada',
        message: 'Berkas video tidak ditemukan. Mungkin sudah dihapus.',
      },
      forbidden: {
        title: 'Tidak bisa diputar',
        message: 'Akun ini tidak punya akses ke video ini.',
      },
      network: {
        title: 'Tidak ada sinyal',
        message: 'Video butuh internet untuk diputar. Sambungkan internet lalu coba lagi.',
      },
      other: {
        title: 'Video belum bisa diputar',
        message: 'Terjadi masalah saat memuat video. Coba lagi sebentar lagi.',
      },
    },
  },
} as const;
