// Guardian manages child accounts: create, reset password, disable, delete (§2.2), plus the
// child list chips on the profile screen.
// UI strings only (Bahasa Indonesia); wired into `id.childAccounts` in ../id.ts and scanned by
// __tests__/forbidden-phrases.test.ts.

export const childAccounts = {
  title: 'Akun anak',

  /** Profile screen: the children list. */
  list: {
    fallbackName: (n: number) => `Anak ${n}`,
    selfName: 'Profil saya',
    chipNone: 'Belum ada akun',
    chipActive: 'Punya akun',
    chipDisabled: 'Akun nonaktif',
    chipPending: 'Sedang dihapus',
    chipLabel: (name: string, status: string) => `${name}, ${status}`,
    teenFooter: 'Profil ini hanya untuk kamu sendiri.',
  },

  /** Section inside the child editor. */
  section: {
    title: 'Akun anak',
    hint: 'Anak bisa punya akun sendiri untuk mencatat sikat gigi dan meminta kamu memeriksa giginya.',
    saveFirst: 'Simpan profil dulu. Setelah itu kamu bisa membuat akun anak.',
    statusNone: 'Belum ada akun anak.',
    statusActive: 'Akun anak aktif.',
    statusDisabled: 'Akun anak nonaktif.',
    statusUnknown: 'Status akun anak belum diketahui.',
    openCreate: 'Buat akun anak',
    openManage: 'Kelola akun anak',
  },

  /** Whole-screen states. */
  screen: {
    intro: (name: string) => `Akun masuk untuk ${name}`,
    loading: 'Memeriksa data anak...',
    notFound: 'Profil anak tidak ditemukan.',
    unavailableTitle: 'Belum tersedia',
    unavailableMessage: 'Akun anak belum bisa dipakai saat ini. Coba lagi nanti.',
    notAllowedTitle: 'Tidak tersedia',
    notAllowedMessage: 'Akun anak hanya bisa dibuat oleh akun orang tua.',
    guestTitle: 'Masuk dulu',
    guestMessage: 'Akun anak butuh akun orang tua. Masuk atau daftar dulu.',
    loadFailedTitle: 'Data belum bisa dimuat',
    retry: 'Coba lagi',
    deletionPending: 'Data anak ini sedang diproses untuk dihapus, jadi akun anak tidak bisa diubah.',
    offlineNote: 'Tidak ada sinyal. Sambungkan internet, lalu coba lagi.',
  },

  /** Step 1: the child must exist on the server (consent b synced). */
  prerequisite: {
    title: 'Kirim data dulu',
    body: 'Akun anak butuh data anak tersimpan di server. Untuk itu, izinkan kirim data tanpa identitas dan tanpa foto.',
    waitingTitle: 'Menunggu data terkirim',
    waitingBody: 'Data anak sedang dikirim ke server. Biasanya hanya sebentar.',
    offline: 'Tidak ada sinyal. Data dikirim otomatis saat sinyal kembali.',
    rejected: 'Data anak belum bisa dikirim.',
    retry: 'Cek lagi',
    retryHint: 'Coba kirim data anak sekarang',
    checking: 'Memeriksa...',
  },

  /** Step 2: create form. */
  create: {
    title: 'Buat akun anak',
    intro: 'Anak masuk dengan email kamu, nama panggilannya, dan kata sandi yang kamu buat di sini.',
    nameWarningTitle: 'Pakai nama panggilan, jangan nama asli',
    nameWarning: 'Nama ini dipakai setiap kali anak masuk. Jangan pakai nama lengkap, nama sekolah, atau data pribadi lain.',
    username: 'Nama panggilan untuk masuk',
    usernameHelper: 'Huruf kecil a-z, angka 0-9, titik, garis bawah, atau minus. 3 sampai 20 huruf. Mulai dengan huruf atau angka.',
    usernameRulesTitle: 'Aturan nama panggilan',
    usernameRules: [
      'Huruf kecil a-z, angka 0-9, titik, garis bawah (_), atau minus (-)',
      '3 sampai 20 karakter',
      'Mulai dengan huruf atau angka',
      'Kata seperti admin atau root tidak boleh dipakai',
    ],
    password: 'Kata sandi anak',
    confirm: 'Ulangi kata sandi',
    passwordTip:
      'Pilih kalimat pendek yang mudah diingat anak. Harus ada huruf besar, huruf kecil, dan angka. Jangan pakai kata sandi akunmu sendiri.',
    videoHint: 'Pilihan. Bisa diubah nanti di Persetujuan data.',
    submit: 'Buat akun anak',
    submitting: 'Membuat akun...',
  },

  /** Field errors shown under the form fields. */
  usernameErrors: {
    empty: 'Isi nama panggilan.',
    too_short: 'Nama panggilan minimal 3 karakter.',
    too_long: 'Nama panggilan maksimal 20 karakter.',
    bad_chars: 'Pakai huruf kecil a-z, angka, titik, garis bawah, atau minus saja.',
    bad_start: 'Mulai dengan huruf atau angka.',
    reserved: 'Nama ini tidak boleh dipakai. Pilih nama lain.',
  },
  fieldErrors: {
    passwordWeak: 'Kata sandi belum memenuhi aturan di bawah.',
    confirmEmpty: 'Ketik ulang kata sandi.',
    confirmMismatch: 'Kata sandi belum sama.',
  },

  /** One-time card after creating the account. */
  created: {
    title: 'Akun anak sudah jadi',
    intro: 'Ajari anak masuk dengan cara ini.',
    step1: 'Buka aplikasi DentisAI dan pilih masuk sebagai anak.',
    emailLabel: 'Email orang tua',
    nameLabel: 'Nama panggilan',
    passwordLabel: 'Kata sandi',
    passwordValue: 'Kata sandi yang baru kamu buat',
    oneTime:
      'Kata sandi tidak disimpan di aplikasi dan tidak bisa dilihat lagi. Ingat atau catat sekarang. Kalau lupa, buat kata sandi baru.',
    videoOn: 'Video bukti sikat gigi sudah kamu izinkan. Bisa dimatikan kapan saja di Persetujuan data.',
    done: 'Selesai',
  },

  /** Account exists. */
  manage: {
    statusTitle: 'Akun masuk anak',
    usernameLabel: 'Nama panggilan',
    statusLabel: 'Status',
    statusActive: 'Aktif',
    statusDisabled: 'Nonaktif',
    signInInfo: 'Anak masuk dengan email kamu, nama panggilan ini, dan kata sandinya.',
    resetTitle: 'Ganti kata sandi',
    resetBody: 'Anak tidak punya fitur lupa kata sandi. Buat kata sandi baru dan beri tahu anak.',
    resetOpen: 'Ganti kata sandi',
    resetSubmit: 'Simpan kata sandi baru',
    resetDone: 'Kata sandi sudah diganti. Beri tahu anak kata sandi barunya.',
    disableTitle: 'Akun aktif',
    disableHint: 'Kalau dimatikan, berlaku langsung. Anak langsung keluar dan tidak bisa masuk atau mencatat sampai akun diaktifkan lagi.',
    disabledDone: 'Akun anak dinonaktifkan.',
    enabledDone: 'Akun anak diaktifkan lagi.',
    deleteTitle: 'Hapus akun masuk',
    deleteBody:
      'Hanya akun masuk anak yang dihapus. Profil dan catatan sikat gigi tetap ada. Untuk menghapus data anak, buat permintaan hapus data terpisah.',
    deleteOpen: 'Hapus akun masuk anak',
    deleteConfirmTitle: 'Hapus akun masuk anak?',
    deleteConfirmBody: 'Anak tidak bisa masuk lagi. Kamu bisa membuat akun baru nanti.',
    deleteConfirm: 'Ya, hapus akun masuk',
    deleteCancel: 'Tidak jadi',
    deleted: 'Akun masuk anak sudah dihapus.',
    videoRow: 'Video bukti sikat gigi',
    videoRowHint: 'Atur izin video di Persetujuan data.',
    cancel: 'Batal',
  },

  /** Friendly copy for every API error code (ACCOUNTS_AND_FLOWS.md §2.2). */
  errors: {
    child_not_found: 'Data anak belum tersinkron. Tunggu sampai data terkirim, lalu coba lagi.',
    child_already_has_account: 'Anak ini sudah punya akun. Kamu bisa mengganti kata sandi atau menonaktifkannya.',
    child_account_limit: 'Batas jumlah akun anak sudah tercapai.',
    username_taken: 'Nama ini sudah dipakai, atau data anak sedang diproses untuk dihapus. Coba nama lain.',
    invalid_username: 'Nama panggilan belum sesuai aturan. Cek aturan di atas.',
    weak_password: 'Kata sandi belum memenuhi aturan. Cek aturan di bawah kolom.',
    unauthorized: 'Sesi masuk sudah habis. Masuk lagi, lalu coba lagi.',
    not_authenticated: 'Sesi masuk sudah habis. Masuk lagi, lalu coba lagi.',
    forbidden: 'Akun ini tidak bisa mengelola akun anak.',
    not_deployed: 'Akun anak belum tersedia. Coba lagi nanti.',
    network: 'Tidak ada sinyal atau koneksi lambat. Coba lagi.',
    not_configured: 'Aplikasi ini belum tersambung ke server.',
    deletion_pending: 'Data anak ini sedang diproses untuk dihapus.',
    too_many_attempts: 'Terlalu sering mencoba. Tunggu sebentar, lalu coba lagi.',
    upstream_unavailable: 'Server sedang sibuk. Coba lagi sebentar lagi.',
    internal: 'Server sedang bermasalah. Coba lagi nanti.',
    generic: 'Belum berhasil. Coba lagi.',
  },
} as const;
