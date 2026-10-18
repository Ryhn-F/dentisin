// Teen first sign-in: birth year-month and ensure_self_profile, then the teen consent texts
// (ACCOUNTS_AND_FLOWS.md §2.1, §2.8; CONSENT_TEXT_DRAFT.md teen variants).
// UI strings only (Bahasa Indonesia); wired into `id.teenSetup` in ../id.ts and scanned by
// __tests__/forbidden-phrases.test.ts.
//
// The teen consent card texts (a, b, d) live in id.consentsV2.teen and are shared with the
// consents screen: one text_version (src/domain/models.ts consentTextVersions) = one wording.

export const teenSetup = {
  title: 'Siapkan profilmu',
  heroTitle: 'Satu langkah lagi',
  heroBody: 'Isi bulan dan tahun lahirmu, lalu pilih data yang boleh disimpan. Semua pilihan mati dulu. Kamu yang memutuskan.',
  selfNickname: 'Saya',

  birth: {
    title: 'Bulan dan tahun lahir',
    help: 'Dipakai untuk menyesuaikan saran. Tanpa nama dan tanpa tanggal lahir.',
  },

  /** Extra line under the "too young" notice: no parent route button here, the account exists. */
  tooYoungExtra: 'Keluar dari akun ini dulu, lalu minta orang tua mendaftar.',

  /**
   * Consent section. The card texts are id.consentsV2.teen (the same wording as the consents
   * screen, so one text_version always means one text).
   */
  consents: {
    title: 'Pilihan data',
    intro: 'Kamu bisa menarik pilihan ini kapan saja.',
    needsB: 'Nyalakan "Kirim datamu tanpa identitas ke server" dulu. Video perlu pilihan itu.',
  },

  submit: 'Simpan dan lanjut',
  signOut: 'Keluar',

  errors: {
    ageOutOfRange: (min: number, max: number) =>
      `Tahun lahir itu belum sesuai untuk akun remaja (usia ${min} sampai ${max} tahun). Ubah tahun lahirmu. Kalau usiamu di bawah ${min} tahun, keluar dari akun ini dan minta orang tua mendaftar.`,
    network: 'Tidak ada koneksi internet. Sambungkan HP ke internet, lalu coba lagi. Pilihanmu di layar ini belum hilang.',
    retry: 'Coba lagi',
    notDeployed: 'Pengaturan akun remaja belum tersedia di server. Coba lagi nanti.',
    sessionExpired: 'Sesi sudah berakhir. Keluar, lalu masuk lagi.',
    unknown: 'Belum berhasil menyimpan. Coba lagi sebentar lagi.',
    refreshFailed: 'Profilmu sudah dibuat, tetapi akunmu belum bisa dimuat. Sambungkan HP ke internet, lalu coba lagi.',
  },
} as const;
