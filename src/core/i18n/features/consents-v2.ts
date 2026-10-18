// Consent screens v2: types a-d, guardian vs teen wording (CONSENT_TEXT_DRAFT.md).
// Plain-words meaning of the draft texts; the text version ids that get recorded live in
// consentTextVersions (src/domain/models.ts). Teen variants speak in the first person ("Saya
// sendiri bersedia"), the guardian variants speak for the child. All of this is DRAFT wording
// that still needs legal review.
// UI strings only (Bahasa Indonesia); wired into `id.consentsV2` in ../id.ts and scanned by
// __tests__/forbidden-phrases.test.ts.

export const consentsV2 = {
  title: 'Persetujuan data',
  noChild: 'Tambah profil anak dulu.',
  intro: (name: string) => `Persetujuan untuk ${name}. Setiap pilihan terpisah, mati sampai kamu menyalakannya, dan bisa ditarik kapan saja.`,
  introSelf: 'Persetujuan untuk dirimu sendiri. Setiap pilihan terpisah, mati sampai kamu menyalakannya, dan bisa ditarik kapan saja.',

  /** Extra row labels (the common ones live in id.consent.labels). */
  labels: {
    who: 'Siapa yang melihat',
    howLong: 'Berapa lama',
    withdraw: 'Kalau ditarik',
  },

  statusNotActive: 'Belum aktif',
  notActiveNote: 'Unggah foto belum aktif sampai ada izin komite etik penelitian.',
  draftNote: 'Teks ini masih draf dan menunggu tinjauan hukum.',
  pendingSync: 'Perubahan ini dikirim ke server saat ada sinyal.',
  dNeedsB: 'Video baru bisa dikirim setelah kirim data tanpa identitas menyala.',
  dNoChildAccount: 'Berlaku setelah anak ini punya akun anak.',
  signInNote: 'Mode tanpa akun: pilihan hanya tersimpan di HP ini.',

  /** Inline confirmation before withdrawing (b) or (d). */
  withdrawB: {
    title: 'Matikan kirim data?',
    message:
      'Data baru tidak dikirim lagi, dan data yang masih menunggu dikirim dibuang. Akun anak juga berhenti mengirim catatan. Data yang sudah ada di server tetap ada sampai kamu meminta penghapusan.',
    confirm: 'Ya, matikan',
    cancel: 'Tidak jadi',
  },
  withdrawD: {
    title: 'Matikan video bukti?',
    message:
      'Video yang sudah ada langsung disembunyikan dan dihapus dari server paling lama dalam 24 jam. Video baru tidak bisa dikirim.',
    confirm: 'Ya, matikan',
    cancel: 'Tidak jadi',
  },

  /** Texts when the guardian decides for a child. */
  guardian: {
    a: {
      title: 'Simpan data anak di HP ini',
      what: 'Kode acak anak, tahun dan bulan lahir, alergi, jawaban gejala, hasil skrining, dan catatan sikat gigi. Tidak ada nama lengkap atau NIK. Hasilnya berupa indikasi, bukan diagnosis.',
      why: 'Supaya riwayat dan saran tampil tanpa internet.',
      where: 'Hanya di HP ini, terkunci. Bisa dihapus kapan saja di Pengaturan.',
      ifDeclined: 'Aplikasi tetap bisa dipakai, tetapi riwayat tidak disimpan.',
    },
    b: {
      title: 'Kirim data tanpa identitas ke server',
      what: 'Tahun dan bulan lahir, tingkat hasil skrining dan tanda yang terlihat (tanpa gambar), tanggal, versi aturan dan model, serta catatan sikat gigi. Semuanya memakai kode acak.',
      why: 'Menyimpan riwayat di beberapa HP, membuat akun anak, dan memperbaiki aplikasi.',
      where: 'Server di Singapura (layanan Supabase), di luar Indonesia. Email hanya dipakai layanan pengirim email untuk konfirmasi dan atur ulang kata sandi.',
      ifDeclined: 'Semua fitur tetap jalan. Data hanya ada di HP ini dan akun anak tidak bisa dibuat.',
      withdraw: 'Data baru tidak dikirim lagi. Kamu bisa meminta data dihapus.',
    },
    c: {
      title: 'Unggah foto gigi untuk pengembangan',
      what: 'Foto gigi depan anak. Foto dikompres, lokasi dan EXIF dihapus, nama berkas acak. Wajah tidak perlu tampil.',
      why: 'Untuk melatih dan menguji model komputer yang membantu mengenali gigi berlubang.',
      where: 'Server privat di Singapura.',
      ifDeclined: 'Tidak mengurangi fitur lain. Foto tidak keluar dari HP ini.',
      who: 'Akan diisi setelah ada izin komite etik penelitian.',
      howLong: 'Akan diisi setelah ada izin komite etik penelitian.',
      withdraw: 'Foto ditandai ditarik dan tidak dipakai untuk pelatihan berikutnya. Model yang sudah dilatih tidak bisa melupakan foto itu.',
    },
    d: {
      title: 'Orang tua boleh menonton video sikat gigi anak',
      what: 'Akun anak merekam video singkat saat menyikat gigi. Video menampilkan mulut dan mungkin wajah anak.',
      why: 'Supaya kamu bisa menontonnya sebagai bukti anak menyikat gigi.',
      where: 'Server privat di Singapura.',
      ifDeclined: 'Anak tetap bisa menyikat gigi dan mencatat streak tanpa video.',
      who: 'Hanya akun kamu. Tidak dipakai melatih model, tidak dibagikan ke guru, sekolah, fasilitas kesehatan, atau admin, dan tidak dianalisis otomatis.',
      howLong: 'Dihapus otomatis paling lama 7 hari setelah direkam. Kamu bisa menghapusnya lebih cepat.',
      withdraw: 'Video yang ada langsung disembunyikan dan dihapus dari server paling lama dalam 24 jam. Video baru tidak bisa dikirim.',
    },
  },

  /** Texts when a teen (15-19) decides for themself: "Saya sendiri bersedia". */
  teen: {
    a: {
      title: 'Simpan datamu di HP ini',
      what: 'Saya berusia 15 sampai 19 tahun. Saya sendiri bersedia DentisAI menyimpan data tentang diri saya: kode acak, tahun dan bulan lahir, alergi, jawaban gejala, hasil skrining, dan catatan sikat gigi. Tidak ada nama lengkap atau NIK. Hasilnya berupa indikasi, bukan diagnosis.',
      why: 'Supaya riwayat dan saran tampil tanpa internet.',
      where: 'Hanya di HP ini, terkunci. Bisa dihapus kapan saja di Pengaturan.',
      ifDeclined: 'Aplikasi tetap bisa dipakai, tetapi riwayat tidak disimpan.',
    },
    b: {
      title: 'Kirim datamu tanpa identitas ke server',
      what: 'Saya berusia 15 sampai 19 tahun. Saya sendiri bersedia DentisAI mengirim data teknis berkode acak tentang diri saya: tahun dan bulan lahir, tingkat hasil skrining dan tanda yang terlihat (tanpa gambar), tanggal, versi aturan dan model, serta catatan sikat gigi.',
      why: 'Menyimpan riwayat di beberapa HP dan memperbaiki aplikasi.',
      where: 'Server di Singapura (layanan Supabase), di luar Indonesia. Email hanya dipakai layanan pengirim email untuk konfirmasi dan atur ulang kata sandi.',
      ifDeclined: 'Semua fitur tetap jalan. Data hanya ada di HP ini.',
      withdraw: 'Data baru tidak dikirim lagi. Kamu bisa meminta data dihapus.',
    },
    c: {
      title: 'Unggah fotomu untuk pengembangan',
      what: 'Saya berusia 15 sampai 19 tahun. Saya sendiri bersedia foto gigi depan saya diunggah. Foto dikompres, lokasi dan EXIF dihapus, nama berkas acak. Wajah tidak perlu tampil.',
      why: 'Untuk melatih dan menguji model komputer yang membantu mengenali gigi berlubang.',
      where: 'Server privat di Singapura.',
      ifDeclined: 'Tidak mengurangi fitur lain. Foto tidak keluar dari HP ini.',
      who: 'Akan diisi setelah ada izin komite etik penelitian.',
      howLong: 'Akan diisi setelah ada izin komite etik penelitian.',
      withdraw: 'Foto ditandai ditarik dan tidak dipakai untuk pelatihan berikutnya. Model yang sudah dilatih tidak bisa melupakan foto itu.',
    },
    d: {
      title: 'Rekam video sikat gigi untuk ditonton sendiri',
      what: 'Saya berusia 15 sampai 19 tahun. Saya sendiri bersedia DentisAI merekam video singkat saat saya menyikat gigi (menampilkan mulut dan mungkin wajah saya) dan menyimpannya supaya saya bisa menontonnya lagi.',
      why: 'Supaya saya sendiri bisa melihat kembali kebiasaan sikat gigi saya.',
      where: 'Server privat di Singapura.',
      ifDeclined: 'Saya tetap bisa menyikat gigi dan mencatat streak tanpa video.',
      who: 'Hanya akun saya. Orang tua, sekolah, fasilitas kesehatan, dan admin tidak bisa melihatnya. Tidak dipakai melatih model dan tidak dianalisis otomatis.',
      howLong: 'Dihapus otomatis paling lama 7 hari. Saya bisa menghapusnya lebih cepat.',
      withdraw: 'Video yang ada langsung disembunyikan dan dihapus dari server paling lama dalam 24 jam. Video baru tidak bisa dikirim.',
    },
  },
} as const;
