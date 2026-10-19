// Guardian / teen home v2: list_children badges, requests and proofs (§4).
// UI strings only (Bahasa Indonesia); wired into `id.homeV2` in ../id.ts and scanned by
// __tests__/forbidden-phrases.test.ts.

export const homeV2 = {
  title: 'Beranda',
  /** Joins names: "Budi, Sari dan Ani" (src/features/home/banners.ts). */
  and: 'dan',

  /** Children without a local nickname (added on another device, or by the server). */
  fallbackName: (n: number) => `Anak ${n}`,
  fallbackNameUnknown: 'Anak',

  /** Streak card: today is not counted yet. */
  keepStreak: 'Sikat gigi hari ini supaya streak tidak putus.',
  /** Week dots (screen reader): "Senin: sudah sikat gigi". */
  dayDone: 'sudah sikat gigi',
  dayNotYet: 'belum sikat gigi',

  banners: {
    requestsTitle: 'Permintaan periksa baru',
    requestsBody: (names: string) => `${names} minta giginya diperiksa.`,
    requestsAction: 'Lihat permintaan',
    proofsTitle: 'Video sikat gigi baru',
    proofsBody: (count: number, name: string) =>
      count === 1 ? `1 video dari ${name} belum ditonton.` : `${count} video dari ${name} belum ditonton.`,
    proofsAction: 'Tonton video',
    deletionTitle: 'Data sedang dihapus',
    deletionBody: (names: string) => `Data ${names} sedang dihapus, jadi tidak dikirim lagi.`,
    deletionBodySelf: 'Data profilmu sedang dihapus, jadi tidak dikirim lagi.',
    unnamedTitle: 'Beri nama panggilan',
    unnamedBody: (count: number) =>
      count === 1
        ? 'Ada 1 anak tanpa nama panggilan. Beri nama di Profil supaya mudah dikenali. Nama hanya tersimpan di HP ini.'
        : `Ada ${count} anak tanpa nama panggilan. Beri nama di Profil supaya mudah dikenali. Nama hanya tersimpan di HP ini.`,
    unnamedAction: 'Buka Profil',
  },

  /** Guardian: always-visible links to the requests list and the proof videos (badges = new). */
  guardian: {
    requestsTitle: 'Permintaan periksa',
    requestsSubtitle: 'Dari akun anak. Lihat dan tanggapi.',
    requestsLabel: (count: number) => (count > 0 ? `Permintaan periksa, ${count} baru` : 'Permintaan periksa'),
    proofsTitle: 'Video sikat gigi anak',
    proofsSubtitle: 'Hanya orang tua yang bisa menonton. Dihapus otomatis.',
    proofsLabel: (count: number) => (count > 0 ? `Video sikat gigi anak, ${count} belum ditonton` : 'Video sikat gigi anak'),
    newCount: (count: number) => `${count} baru`,
  },

  /** Teen account: the app is for the teen's own teeth (no children, no add-child). */
  teen: {
    subtitle: 'Yuk jaga gigimu hari ini.',
    /** Screening card while photo screening is active (teens screen themselves). */
    screeningCardBody: 'Foto gigi depanmu, lalu lihat kapan perlu ke dokter gigi.',
    reminderBody: 'Periksakan gigimu secara rutin ke dokter gigi atau puskesmas, walau tidak sakit.',
    proofsTitle: 'Video sikat gigiku',
    proofsSubtitle: 'Hanya kamu yang bisa menonton. Dihapus otomatis.',
    proofsNew: (count: number) => `${count} baru`,
    proofsLabel: (count: number) =>
      count > 0 ? `Video sikat gigiku, ${count} belum ditonton` : 'Video sikat gigiku',
  },
} as const;
