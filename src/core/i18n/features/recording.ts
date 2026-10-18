// Brushing proof recording (consent d; child and teen accounts). The child account reads these
// too, so every line uses simple words (grade 4). The instructions shown while brushing (ring,
// zones) stay in id.brushing; this module only covers the video part.
// UI strings only (Bahasa Indonesia); wired into `id.recording` in ../id.ts and scanned by
// __tests__/forbidden-phrases.test.ts.

export const recording = {
  title: 'Rekam video sikat gigi',

  /** Pre-start switch: says clearly, BEFORE recording, who can watch and for how long. */
  toggleParent: 'Rekam video untuk orang tua',
  toggleSelf: 'Rekam video untuk dilihat sendiri',
  noteParent: (days: number) => `Hanya orang tuamu yang bisa melihat. Video dihapus otomatis setelah ${days} hari.`,
  noteSelf: (days: number) => `Hanya kamu yang bisa melihat. Video dihapus otomatis setelah ${days} hari.`,
  noSound: 'Video direkam tanpa suara dan tidak masuk galeri.',

  /** Why the switch is missing (only reasons the person can fix or should know). */
  unavailable: {
    proofNotAllowed: 'Rekam video belum aktif. Minta orang tuamu menyalakannya.',
    noConsent: 'Untuk merekam video, nyalakan izin video di Profil, Persetujuan data.',
    permissionDenied: 'Izin kamera mati, jadi sikat gigi pakai timer saja.',
    cameraError: 'Kamera tidak bisa dipakai, jadi sikat gigi pakai timer saja.',
    dailyLimit: (count: number) => `Video hari ini sudah cukup (${count} video). Sikat gigi tetap tercatat.`,
  },

  /** Friendly explanation before the system camera prompt. */
  permissionTitle: 'Izinkan kamera',
  permissionBody: 'Kamera depan dipakai untuk merekam video sikat gigi tanpa suara. Video tidak masuk galeri.',
  permissionAllow: 'Izinkan kamera',
  permissionSkip: 'Pakai timer saja',
  permissionDenied: 'Izin kamera tidak diberikan. Sikat gigi tetap jalan dengan timer.',

  /** While recording. */
  starting: 'Menyalakan kamera…',
  previewLabel: 'Kamera depan sedang menyala',
  recordingBadge: 'Merekam',
  recordingLabel: 'Sedang merekam video tanpa suara',
  pausedBadge: 'Jeda',
  pausedLabel: 'Rekaman dijeda',
  cameraFailed: 'Kamera berhenti. Lanjut sikat gigi dengan timer, ya.',
  recordingStopped: 'Videonya sudah cukup. Lanjutkan sikat gigi, ya.',

  /** Done screen: this session's video. */
  sessionRecorded: 'Sesi sikat gigi tercatat.',
  status: {
    title: 'Video sikat gigi',
    preparing: 'Menyiapkan video…',
    waiting: 'Video dikirim saat ada sinyal.',
    uploading: (pct: number) => `Mengirim video ${pct}%`,
    uploadingLabel: (pct: number) => `Mengirim video, ${pct} persen`,
    retrying: 'Belum ada sinyal. Video dikirim otomatis nanti.',
    doneParent: 'Video terkirim. Orang tuamu bisa melihatnya.',
    doneSelf: 'Video terkirim. Hanya kamu yang bisa melihatnya.',
    background: 'Kamu boleh menutup layar ini. Video tetap dikirim.',
  },

  /** The clip was not sent (checked on the phone before anything is sent). */
  skipped: {
    tooShort: 'Videonya terlalu pendek, jadi tidak dikirim.',
    tooLarge: 'Videonya terlalu besar, jadi tidak dikirim dan sudah dihapus dari HP.',
    tooLong: 'Videonya terlalu panjang, jadi tidak dikirim dan sudah dihapus dari HP.',
    missing: 'Videonya tidak tersimpan. Sesi sikat gigi tetap tercatat.',
    notSent: 'Video tidak bisa dikirim sekarang. Sesi sikat gigi tetap tercatat.',
  },

  /** The server refused the video (final). The local file is deleted. */
  failures: {
    limitExceeded: 'Video hari ini sudah cukup. Sesi sikat gigi tetap tercatat.',
    consentParent: 'Video tidak dikirim. Minta orang tuamu menyalakan izin video. Sesi sikat gigi tetap tercatat.',
    consentSelf: 'Video tidak dikirim. Nyalakan izin video di Profil, Persetujuan data. Sesi sikat gigi tetap tercatat.',
    featureDisabled: 'Fitur video sedang dimatikan. Sesi sikat gigi tetap tercatat.',
    forbidden: 'Video tidak bisa dikirim dari akun ini. Sesi sikat gigi tetap tercatat.',
    deletionPending: 'Data sedang dihapus, jadi video tidak dikirim.',
    expired: 'Videonya sudah terlalu lama menunggu, jadi dihapus dari HP.',
    fileMissing: 'File videonya hilang dari HP. Sesi sikat gigi tetap tercatat.',
    other: 'Video tidak bisa dikirim. Sesi sikat gigi tetap tercatat.',
  },
} as const;
