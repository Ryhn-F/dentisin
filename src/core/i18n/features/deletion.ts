// Data deletion by guardian / teen accounts (request_deletion: SUPABASE_API.md §3.2,
// ACCOUNTS_AND_FLOWS.md §1, §9). Child accounts never delete; they ask their parent.
// UI strings only (Bahasa Indonesia); wired into `id.deletion` in ../id.ts and scanned by
// __tests__/forbidden-phrases.test.ts.

export const deletion = {
  /** Header of the deletion screen. */
  title: 'Hapus data',

  /** Rows in Pengaturan akun (the guardian rows reuse id.settings.deleteChild / deleteAccount). */
  settings: {
    selfRow: 'Hapus data profil saya',
    /** Row at the bottom of one child's profile (guardian). */
    childRow: 'Hapus data anak ini',
    footer: 'Penghapusan butuh internet dan tidak bisa dibatalkan.',
  },

  /** Whole-screen states before the flow can start. */
  gate: {
    loading: 'Memuat data akun...',
    guestTitle: 'Masuk dulu',
    guestMessage: 'Mode tanpa akun tidak menyimpan data di server, jadi tidak ada yang perlu dihapus di sana.',
    childTitle: 'Minta orang tua',
    childMessage: 'Hanya orang tua yang bisa menghapus data. Minta orang tuamu, ya.',
    noChildrenTitle: 'Belum ada data anak',
    noChildrenMessage: 'Belum ada data anak yang bisa dihapus.',
    notFound: 'Profil tidak ditemukan.',
    back: 'Kembali',
  },

  /** Guardian picks which child. */
  choose: {
    title: 'Pilih anak',
    hint: 'Data anak yang kamu pilih dihapus dari server dan dari HP ini.',
    pendingChip: 'Sedang dihapus',
    pendingOthers: (n: number) =>
      n === 1 ? 'Data 1 anak lain sedang dihapus.' : `Data ${n} anak lain sedang dihapus.`,
  },

  /** Step 1: what is deleted and what is not. */
  explain: {
    heading: {
      child: (name: string) => `Hapus data ${name}`,
      self: 'Hapus data profil saya',
      account: 'Hapus akun',
    },
    deletedTitle: 'Yang dihapus',
    keptTitle: 'Yang tidak ikut terhapus',
    deleted: {
      child: [
        'Profil anak: tahun dan bulan lahir, alergi, dan persetujuan.',
        'Riwayat skrining, surat rujukan, dan catatan sikat gigi.',
        'Akun masuk anak dan video bukti sikat gigi.',
        'Permintaan periksa dari anak.',
        'Data anak ini di HP ini, termasuk nama panggilan.',
      ],
      self: [
        'Profilmu: tahun dan bulan lahir, alergi, dan persetujuan.',
        'Riwayat skrining, surat rujukan, dan catatan sikat gigi.',
        'Video bukti sikat gigimu.',
        'Data profil ini di HP ini.',
      ],
      accountGuardian: [
        'Semua anak dan datanya: profil, persetujuan, riwayat skrining, surat rujukan, dan catatan sikat gigi.',
        'Semua akun anak dan video bukti sikat gigi.',
        'Akunmu: email dan kata sandi.',
        'Semua data akun ini di HP ini.',
      ],
      accountTeen: [
        'Profilmu dan semua datanya: persetujuan, riwayat skrining, surat rujukan, dan catatan sikat gigi.',
        'Video bukti sikat gigimu.',
        'Akunmu: email dan kata sandi.',
        'Semua data akun ini di HP ini.',
      ],
    },
    kept: {
      model:
        'Model AI yang sudah dilatih tidak bisa lupa. Jika foto pernah dipakai untuk melatihnya, model itu tidak berubah. Foto tidak dipakai lagi untuk model baru.',
      shared: 'Surat rujukan atau berkas yang sudah kamu bagikan atau simpan di luar aplikasi.',
      otherPhones: 'Data di HP lain yang memakai akun ini. Hapus juga dari HP itu.',
      otherPhonesWithKids: 'Data di HP lain, termasuk HP yang dipakai akun anak. Hapus juga dari HP itu.',
      proofRecord: 'Catatan bahwa penghapusan pernah dilakukan. Catatan ini tidak berisi data pribadi.',
    },
    factsTitle: 'Sebelum lanjut',
    facts: {
      internet: 'Butuh sinyal internet.',
      timing: 'Server menghapus semuanya dalam beberapa jam. Selama itu, data tidak dikirim lagi.',
      final: 'Penghapusan tidak bisa dibatalkan.',
      selfKeepsAccount: 'Akunmu tetap ada. Setelah penghapusan selesai, kamu bisa membuat profil baru.',
      signOut: 'Setelah ini kamu keluar dari akun.',
    },
    acknowledge: 'Saya paham data yang dihapus tidak bisa dikembalikan.',
    acknowledgeError: 'Centang dulu kotak ini.',
    next: 'Lanjut',
    cancel: 'Batal',
  },

  /** Step 2: the final confirmation. The safe choice is the primary button. */
  confirm: {
    title: {
      child: (name: string) => `Hapus data ${name} sekarang?`,
      self: 'Hapus data profilmu sekarang?',
      account: 'Hapus akun sekarang?',
    },
    message: 'Ini langkah terakhir. Setelah ini data tidak bisa dikembalikan.',
    confirmData: 'Ya, hapus data',
    confirmAccount: 'Ya, hapus akun',
    cancel: 'Batal',
  },

  /** After the request. */
  done: {
    title: 'Permintaan diterima',
    child: (name: string) => `Data ${name} di HP ini sudah dihapus. Server menghapus sisanya dalam beberapa jam.`,
    localOnly: (name: string) => `Data ${name} sudah dihapus dari HP ini. Data ini belum pernah tersimpan di server.`,
    self: 'Data profilmu di HP ini sudah dihapus. Server menghapus sisanya dalam beberapa jam.',
    finish: 'Selesai',
    /** Shown on the welcome screen after the account deletion signed the user out. */
    accountTitle: 'Akun sedang dihapus',
    account: 'Data di HP ini sudah dihapus dan kamu sudah keluar. Server menghapus sisanya dalam beberapa jam.',
  },

  /** A deletion that was already requested (here or on another phone). */
  pending: {
    child: (name: string) => `Data ${name} sedang dihapus. Tidak ada data yang dikirim lagi.`,
    self: 'Data profilmu sedang dihapus. Tidak ada data yang dikirim lagi.',
  },

  /** request_deletion failures (codes from src/core/account/api.ts). */
  errors: {
    network: 'Tidak ada sinyal. Sambungkan internet, lalu coba lagi.',
    not_authenticated: 'Sesi masuk sudah berakhir. Keluar, masuk lagi, lalu coba lagi.',
    unauthorized: 'Sesi masuk sudah berakhir. Keluar, masuk lagi, lalu coba lagi.',
    forbidden: 'Data ini tidak bisa dihapus dari akun ini.',
    not_configured: 'Aplikasi ini belum tersambung ke server.',
    not_deployed: 'Penghapusan belum tersedia di server. Coba lagi nanti.',
    generic: 'Permintaan belum terkirim. Coba lagi sebentar lagi.',
  },
} as const;
