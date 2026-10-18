// Child login: parent email + username + password (child-login, §2.3). Grade-4 wording.
// UI strings only (Bahasa Indonesia); wired into `id.childLogin` in ../id.ts and scanned by
// __tests__/forbidden-phrases.test.ts.

export const childLogin = {
  title: 'Masuk akun anak',
  entryButton: 'Masuk sebagai anak',
  heroTitle: 'Halo, teman gigi!',
  heroBody: 'Isi data dari orang tuamu, lalu masuk.',
  parentEmail: 'Email orang tua',
  parentEmailHelper: 'Email yang dipakai orang tuamu untuk mendaftar.',
  username: 'Nama kamu',
  usernameHelper: 'Nama masuk yang dibuat orang tuamu.',
  password: 'Kata sandi',
  submit: 'Masuk',
  submitWait: (seconds: number) => `Tunggu ${seconds} detik`,
  forgotHint: 'Lupa kata sandi? Minta orang tua membuat yang baru.',
  backToLogin: 'Kembali ke masuk biasa',
  fieldErrors: {
    emailRequired: 'Isi email orang tua.',
    emailInvalid: 'Email belum benar.',
    usernameRequired: 'Isi nama kamu.',
    usernameInvalid: 'Nama belum benar. Pakai huruf kecil dan angka.',
    passwordRequired: 'Isi kata sandi.',
  },
  errors: {
    // One message for every cause: never reveal which part was wrong.
    invalidCredentials: 'Email orang tua, nama, atau kata sandi salah.',
    tooManyAttempts: 'Terlalu banyak percobaan. Coba lagi nanti, atau minta bantuan orang tua.',
    busy: 'Sedang sibuk, coba lagi.',
    notDeployed: 'Masuk untuk anak belum tersedia.',
    generic: 'Belum bisa masuk. Coba lagi nanti.',
  },
} as const;
