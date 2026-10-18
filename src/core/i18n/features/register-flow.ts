// Register flow v2: role choice (teen / guardian), teen age gate, sign-up form (ADR 017/018).
// UI strings only (Bahasa Indonesia); wired into `id.registerFlow` in ../id.ts and scanned by
// __tests__/forbidden-phrases.test.ts. Age bounds are passed in as arguments (display constants
// 15..19; the server decides finally with age_out_of_range).

export const registerFlow = {
  title: 'Daftar',

  /** Step 1: who uses DentisAI. */
  role: {
    heroTitle: 'Siapa yang memakai DentisAI?',
    heroBody: 'Pilih satu. Pilihan ini menentukan isi aplikasi untukmu.',
    guardian: {
      title: 'Saya orang tua',
      body: 'Saya membuat profil anak dan akun anak untuk mencatat sikat gigi. Saya yang memeriksa gigi anak.',
      a11y: 'Daftar sebagai orang tua',
    },
    teen: {
      title: 'Untuk saya sendiri',
      badge: (min: number, max: number) => `Remaja ${min} sampai ${max} tahun`,
      body: 'Saya memeriksa gigi sendiri dan mencatat sikat gigi sendiri.',
      a11y: (min: number, max: number) => `Daftar untuk diri sendiri, remaja ${min} sampai ${max} tahun`,
    },
  },

  /** Step 1b (teen only): birth year and month before the form. */
  birth: {
    heroTitle: 'Kapan kamu lahir?',
    heroBody: (min: number, max: number) =>
      `Akun untuk diri sendiri khusus usia ${min} sampai ${max} tahun. Kami hanya perlu tahun dan bulan lahir, bukan tanggal.`,
    yearLabel: 'Tahun lahir',
    monthLabel: 'Bulan lahir',
    monthOptional: 'Boleh dilewati kalau tahun lahirmu sudah jelas.',
    monthUnknown: 'Tidak ingat',
    yearA11y: (year: number) => `Tahun lahir ${year}`,
    monthA11y: (month: string) => `Bulan lahir ${month}`,
    monthUnknownA11y: 'Bulan lahir tidak ingat',
    yearRequired: 'Pilih tahun lahirmu dulu.',
    continue: 'Lanjut',
  },

  /** Age gate messages (shared with the teen setup screen). */
  gate: {
    needsMonthTitle: 'Pilih bulan lahir',
    needsMonth: (lo: number, hi: number) =>
      `Dari tahun lahirmu saja, usiamu bisa ${lo} atau ${hi} tahun. Pilih bulan lahir untuk melanjutkan. Kalau lupa, tanyakan ke orang tua.`,
    tooYoungTitle: (min: number) => `Akun ini untuk usia ${min} tahun ke atas`,
    tooYoung:
      'Untuk anak di bawah usia itu, orang tua yang mendaftar sebagai orang tua, lalu membuat profil dan akun anak.',
    tooOldTitle: (min: number, max: number) => `Akun ini untuk usia ${min} sampai ${max} tahun`,
    tooOld: 'Kalau kamu orang tua atau wali, daftar sebagai orang tua. Dari sana kamu bisa membuat profil untuk anakmu.',
    useGuardian: 'Daftar sebagai orang tua',
  },

  /** Step 2: the account form. */
  form: {
    heroTitleTeen: 'Buat akunmu',
    typeGuardian: 'Daftar sebagai orang tua',
    typeTeen: 'Daftar untuk diri sendiri',
    born: (when: string) => `Lahir ${when}`,
    change: 'Ganti',
    changeLabel: 'Ganti jenis akun',
  },

  /** Hint on the check-email screen. */
  checkEmail: {
    teenNext: 'Setelah email dikonfirmasi dan kamu masuk, kamu akan mengisi profil dan memilih data yang boleh disimpan.',
    guardianNext: 'Setelah email dikonfirmasi dan kamu masuk, kamu bisa menambah profil anak.',
  },
} as const;
