# Prinsip Desain UI/UX — DentisAI (app/)

> Status: **DRAF v0.2 (2026-10-09)** — tema visual v3 "playful & bold" (ADR 011). Untuk ditinjau tim, drg pembimbing (bahasa & warna triase), dan diuji pada ≥ 5 anak kelas 4 SD.
> Bersumber dari [`docs/research/10_ui_ux_design_references.md`](../../docs/research/10_ui_ux_design_references.md) + skill `expo-design-system` / `expo-native-ui` / `expo-animation`.
> **Konflik: `../../CLAUDE.md` dan `../CLAUDE.md` menang.** Dokumen ini tidak mengubah aturan klinis, privasi, atau stack. Kode & komentar Inggris; teks UI Indonesia sederhana.

## 0. Cara memakai
- Tiap prinsip bernomor (`P1…`) dan **dapat diuji**: ada kolom "Bukti/uji". Review PR UI = centang daftar §11.
- Nilai warna/ukuran di sini = **usulan awal** (kecuali kontras, sudah dihitung). Sumber kebenaran kode: `src/core/theme` (satu-satunya tempat token).
- Bila bertentangan dengan default skill Expo (mis. warna semantik OS), keputusan dicatat di §12.

## 1. Prinsip inti (urutan prioritas bila bentrok)

| # | Prinsip | Artinya di layar | Bukti / uji |
|---|---|---|---|
| **P1** | **Keselamatan menang atas keindahan.** Red flag & rujukan tampil sebelum, di atas, dan lebih jelas daripada hiasan apa pun. | Layar darurat: tanpa maskot, tanpa animasi, kontras maksimum, tombol rujukan/telepon besar, jalan offline. | Tes: layar darurat tidak mengimpor komponen maskot/animasi; Maestro mode pesawat. |
| **P2** | **Indikasi, bukan diagnosis.** Bahasa & visual tidak menyiratkan kepastian. | Kata "indikasi/perlu diperiksa"; tanpa angka akurasi; tanpa ikon ✔ besar yang berarti "sehat". Disclaimer + CTA rujukan di setiap layar hasil (🟢 juga). | Lint frasa terlarang (`docs/style/forbidden_phrases.md`); snapshot layar hasil memuat disclaimer & CTA. |
| **P3** | **Jelas untuk anak SD dan orang tua sekaligus.** Satu tugas per layar, satu tindakan utama. | Mode anak: ikon + kata pendek, tanpa input teks bebas, tanpa tautan keluar. Teks ≈ kelas 4 SD. | Uji 5 anak; skor keterbacaan; tidak ada istilah klinis di mode anak ("lubang gigi", bukan "kavitas"). |
| **P4** | **Ramah HP murah & jaringan buruk.** Desain yang jalan di Android RAM 3 GB, offline. | Tanpa blur/kaca, tanpa Lottie berat, bayangan minimal; gerak hanya `transform`/`opacity`; semua aset ter-bundel. | Benchmark app/docs/benchmarks.md; FPS ≥ target setelah 2 menit; tes tanpa permintaan jaringan. |
| **P5** | **Privasi terlihat, bukan disembunyikan.** Persetujuan granular, jujur, bisa ditolak tanpa kehilangan fitur inti. | Tiga persetujuan terpisah, default mati; penjelasan "apa, kenapa, ke mana, kalau menolak"; bukan dialog izin OS yang dibundel. | Tes UI consent; tidak ada tombol "Setuju semua" yang menyalakan (c) unggah foto. |
| **P6** | **Ramah, bukan menakutkan — dan bukan menipu.** Motivasi tanpa rasa bersalah, tanpa dorongan konsumtif. | Streak memaafkan (jeda, bukan hukuman); tak ada iklan/IAP/hitung-mundur menekan; foto lesi besar tidak ditampilkan di mode anak. | Review konten; tidak ada SDK iklan; checklist §8. |
| **P7** | **Satu sistem, bukan kumpulan layar.** Semua nilai visual dari token; komponen dipakai ulang. | Tak ada hex/ukuran literal di luar `src/core/theme`. | Grep §10; audit drift. |

## 2. Dua mode, satu sistem
Satu set token, dua "kepadatan" (bukan dua app):

| | **Mode Anak** | **Mode Orang Tua / Kader / Guru** |
|---|---|---|
| Navigasi | Selalu terlihat, **ikon + kata**, maks 3 tujuan | Tab bawah standar Android, ikon + label |
| Target sentuh | **≥ 56dp** (tombol utama 64dp) | **≥ 48dp** |
| Teks isi | ≥ 18sp | ≥ 16sp |
| Gestur | tap / geser / seret saja; tanpa pinch/double-tap | + gestur standar sistem (back) |
| Input | tanpa teks bebas, tanpa akun | form normal |
| Maskot | ya, besar, emosi positif | kecil, pendukung |
| Konten | maks ~1 kalimat per instruksi, + suara | kartu ringkas + detail bila diminta |

Dasar: pedoman Google *Building for Kids* (target besar, navigasi tampak, ikon+teks, gestur sederhana) dan Android a11y 48×48dp. Angka 56/64dp = **usulan**, validasi dengan anak `[PERLU VERIFIKASI]`.

## 3. Identitas visual

### 3.1 Arah (v3, 2026-10-09 — ADR 011)
**"Playful & bold":** mengikuti dua referensi visual pemilik produk — (1) aplikasi kursus dengan panggung biru tebal, CTA pil kuning, kartu kursus warna jenuh, bottom nav dengan indikator biru; (2) aplikasi dental biru dengan blob organik koral, header melengkung, chip kalender pil.
- **Warna jenuh dipakai dalam blok besar** (hero biru, kartu fitur biru/kuning/koral) di atas latar lavender lembut; teks tetap navy atau putih sesuai kontras.
- **Bentuk bulat & organik:** kartu radius 28, sheet 36, tombol pil, blob/cincin/kilau dekoratif (`src/components/decor.tsx`).
- **Maskot "Gigi" orisinal** (SVG, `src/components/mascot.tsx`) menggantikan ilustrasi 3D referensi — placeholder sampai ilustrasi dikomisi; tidak pernah di layar hasil/darurat.
- Hierarki tetap dari ukuran & berat teks dulu; bayangan lembut berwarna biru hanya untuk kartu putih dan tombol utama.
- **Aturan dekorasi:** koral/kuning tidak boleh berada di belakang teks atau ikon putih (2,8:1 / 1,6:1); biru tua boleh (7,4:1).

### 3.2 Warna (v3 — kontras WCAG dihitung & diuji otomatis)
Sumber kebenaran: `src/core/theme/colors.ts` → diekspor ke Tailwind (`tailwind.config.ts`). Light mode saja. Warna **tetap (eksplisit)**, bukan warna dinamis wallpaper.

| Token (kelas) | Nilai | Pakai | Kontras |
|---|---|---|---|
| `bg` | `#F3F5FF` | latar halaman (lavender) | |
| `surface` | `#E7EBFD` | trek kontrol, latar sekunder | |
| `card` | `#FFFFFF` | kartu, grup daftar, sheet | |
| `text` (`ink`) | `#1C1E4F` | teks utama (navy) | 14,3:1 di `bg` |
| `textSecondary` (`ink-soft`) | `#5A5F86` | teks sekunder | ≥ 5,0:1 di semua latar & tint |
| `primary` | `#3D5AF1` | hero, tombol utama, tab aktif, tautan | putih 5,3:1; sebagai teks ≥ 4,5:1 di bg/surface/card |
| `primaryDeep` | `#2C44CF` | blob, pil di atas biru, teks tombol sekunder | putih 7,4:1 |
| `accent` (`sun`) | `#FFC52E` | CTA utama, hadiah, titik streak | **teks navy** 9,9:1 (putih gagal) |
| `coral` | `#FF6B5B` | dekorasi, kartu fitur | **teks navy** 5,6:1 (putih 2,8:1 — dilarang) |
| `success` / `danger` | `#16784A` / `#C62F24` | status teks | ≥ 5,0:1 di bg/surface/card |
| `outline` | `#7D84AE` | tepi input, trek switch mati | 3,1–3,6:1 (non-teks) |
| tint `lavender · sky · cream · peach · mint` | `#E3E8FF · #DCEAFF · #FFF2CC · #FFE2DC · #D9F3EA` | latar banner, kartu lembut, ikon tile | teks navy/sekunder ≥ 5,0:1 |

**Level triase** — tidak berubah oleh tema; selalu **warna + ikon + kata + bentuk** (jangan warna saja; buta warna):

| Level | Kata | Warna | Teks di atasnya | Ikon (Material) |
|---|---|---|---|---|
| Darurat | "Segera ke fasilitas kesehatan" | `#B3261E` | putih 6,5:1 | segitiga peringatan |
| Segera | "Periksa dalam beberapa hari" | `#A04A00` | putih 6,0:1 | jam/kalender cepat |
| Terjadwal | "Buat janji periksa" | `#F2C230` | `#2B2100` 9,5:1 | kalender |
| Rutin | "Periksa rutin 3–6 bulan" | `#1E7A46` | putih 5,4:1 | centang-dengan-jam, **bukan** centang "sehat" |

> Kata level final = hak drg (jangan ubah makna klinis). Nilai di atas = bahasa UI usulan.
> Overlay kotak deteksi memakai palet ramah buta-warna **dan** bentuk/garis berbeda (app/CLAUDE.md §6.3).

### 3.3 Tipografi
- **Plus Jakarta Sans** (desainer Indonesia, OFL-1.1, ter-bundel 400/500/600/700/800 lewat subpath import; lisensi diverifikasi di `LICENSE_FONT`) untuk seluruh UI — geometris tebal seperti referensi.
- Skala (sumber: `src/core/theme/typography.ts` → kelas `text-*`) — hormati font scale OS, **jangan** `allowFontScaling={false}`:

| Gaya | sp / line | Berat | Pakai |
|---|---|---|---|
| `hero` | 52/60 | 800 | angka besar (streak, timer) |
| `display` | 32/40 | 800 | judul sambutan/hero |
| `title` | 22/30 | 800 | judul bagian/kartu besar |
| `headline` | 17/24 (anak 19) | 700 | judul kartu, tombol |
| `label` | 14/20 | 600 | label field, chip, tab |
| `body` | 16/24 (anak 18) | 400 | isi |
| `bodyStrong` | 16/24 (anak 18) | 600 | judul baris daftar |
| `caption` | 14/20 (anak 16) | 500 | keterangan (**tidak** untuk disclaimer penting) |

- Disclaimer "bukan diagnosis" dan kata level triase **tidak boleh** di `caption` kecil/abu-abu muda.
- Layout harus bertahan di teks besar: `minHeight` + padding, label membungkus; uji font scale 200%.
- Angka/timer: `tabular-nums` (ramp `hero`).

### 3.4 Spasi, radius, bayangan
- Tepi layar 20dp (`px-5`); jarak antarbagian 28dp (`gap-7`); antarbaris < antarkelompok < antarbagian (anti "16-Everything").
- Radius: field 18 · tile 24 · card 28 · sheet 36 · pil penuh; `borderCurve: 'continuous'`.
- Bayangan (string `boxShadow`, berwarna biru lembut): `card`, `raised`, `button` (glow biru), `accentButton` (glow kuning). Tanpa `elevation`/`shadow*` lama.
- Hairline hanya sebagai pemisah baris di dalam grup daftar putih.

### 3.5 Ikon & ilustrasi
- **Satu keluarga ikon** (Material Icons; Android-only app). **Tanpa emoji sebagai ikon** (tab, tombol, state kosong). Emoji hanya boleh di dokumen, bukan di UI.
- Ilustrasi/maskot: SVG atau PNG ter-bundel orisinal, dioptimalkan; **tanpa** gambar lesi/rongga mulut realistis di mode anak.
- State kosong & error: ilustrasi kecil maskot + satu kalimat + satu tindakan.

## 4. Maskot (orisinal)
- Peran: **pemandu & teman semangat**, bukan penilai medis. Tidak pernah menyampaikan level Darurat/Segera.
- Pose minimum: menyapa, menunjuk, semangat/menyikat, bangga (hadiah), mengantuk/selesai (tutup sesi), bingung-ramah (foto perlu diulang).
- Tidak memakai kata/ekspresi menakut-nakuti ("gigi busuk", "kuman jahat menyerang"). Kuman = "sisa makanan" bila perlu.
- Aksesibilitas: maskot dekoratif → `accessibilityElementsHidden`; makna selalu ada di teks.
- Brief: 3 arah maskot orisinal → uji pilihan dengan anak (Fase 6). Hak cipta ilustrator/dibuat tim dicatat.

## 5. Layar kunci

### 5.1 Layar darurat (red flag) — P1
Urutan: ikon + kalimat tegas ("Segera bawa ke fasilitas kesehatan") → alasan 1 baris → **tombol utama besar** (cari faskes / telepon / buka rujukan PDF) → tombol sekunder "Saya sudah ke dokter". Tanpa maskot, tanpa gerak, tanpa upsell, tanpa "lanjut ke foto". Tersedia **offline**. Kontras `#B3261E` + putih.

### 5.2 Kuesioner gejala (sebelum foto)
Satu pertanyaan per layar, jawaban Ya/Tidak/Tidak tahu bertombol besar, kemajuan tampak ("2 dari 6"), tombol kembali selalu ada, bisa dilanjutkan bila ditutup. Bahasa awam; contoh ("bengkak di pipi/wajah").

### 5.3 Pemotretan terpandu
- Overlay posisi gigi + satu instruksi aktif sekaligus ("Tarik bibir sedikit").
- Umpan balik **teks + ikon + suara**; instruksi berubah bila gagal: gelap → "Nyalakan senter", goyang → "Tahan HP", bibir menutup → "Tarik sedikit".
- Foto gagal quality gate = **ulang yang ramah** (maskot bingung-ramah), bukan pesan error; ini fitur utama (hanya 45% foto diagnostik pada uji AICaries).
- Hitung-mundur tampak; tombol rana ≥ 64dp; jangan tombol rana di area ibu jari yang tertutup genggaman (uji di HP nyata).
- Izin kamera diminta **tepat sebelum** layar ini, dengan penjelasan sendiri; menolak → jalur alternatif (kuesioner + edukasi) tetap ada.

### 5.4 Layar hasil
Urutan tetap: **(1) level: warna+ikon+kata → (2) alasan singkat (indikasi, bahasa awam) → (3) CTA rujukan (tombol utama) → (4) saran perawatan di rumah → (5) rekomendasi pasta (bila ada) → (6) batasan foto + disclaimer.**
- Selalu ada CTA rujukan dan teks "Hasil ini bukan diagnosis dan tidak menggantikan pemeriksaan dokter gigi." — termasuk 🟢 (+ "skrining ulang 3–6 bulan").
- Overlay kotak: label sederhana; `caries_noncavitated` = "perlu perhatian", tidak dramatis.
- Tanpa angka akurasi, tanpa persentase "risiko" yang tampak ilmiah, tanpa skor.
- Mode anak: tampilan lunak (maskot + "Yuk periksa ke dokter gigi bareng orang tua"); detail untuk orang tua di layar terpisah.

### 5.5 Rekomendasi pasta gigi
Kandungan/ppm dulu, lalu jumlah pakai per usia (ikon ukuran sebiji beras/kacang polong), lalu ≥ 2 contoh produk netral. Selalu: "Pasta gigi membantu, tetapi tidak menambal gigi berlubang." Tanpa logo merek besar, tanpa tombol beli/tautan toko.

### 5.6 Sikat gigi (streak)
- Loop: **timer 2 menit → peta mulut (zona yang sedang disikat) → hadiah → penutup.**
- **Penutup sesi** yang jelas (pelajaran Philips: anak sulit berhenti): maskot mengantuk/ucap sampai jumpa; layar selesai tidak menawarkan "main lagi" tanpa batas.
- Skor = "skor semangat", bukan nilai klinis. Umpan balik "gigi belakang kiri bawah ya!" = panduan.
- Kamera gagal/HP lemah → **fallback timer + musik** tanpa kamera, streak tetap jalan.
- Streak memaafkan: melewatkan sehari = "istirahat", bukan layar sedih/merah. Jendela pagi & malam dapat diatur.
- Frame tidak disimpan; tampilkan indikator kecil "kamera tidak merekam" saat dipakai.

### 5.7 Persetujuan & privasi — P5
Tiga kartu terpisah: (a) simpan di HP, (b) kirim data teknis tanpa identitas, (c) unggah foto — **(c) default mati, tidak digabung**. Tiap kartu: apa, kenapa, ke mana (Singapura), berapa lama, hak tarik; "kalau menolak: masih bisa …". Tidak ada pola gelap (tombol Tolak sama jelas dengan Setuju). Persetujuan orang tua tercatat sebelum foto murid (mode kader).

### 5.8 Mode kader/guru
Padat tapi tetap ≥ 48dp: daftar murid pseudonim, antrean foto, rekap per level (warna+ikon+kata), ekspor. Konfirmasi persetujuan per murid terlihat sebelum tombol foto aktif.

### 5.9 Edukasi
Kartu statis: satu gagasan, satu gambar, ≤ 3 baris; audio ter-bundel (+ label "suara dibuat dengan AI" di Tentang). Tanpa chat/teks bebas.

## 6. Komponen & pola
- **Kontrak komponen:** varian, ukuran, state (default/pressed/disabled/loading), `style` digabung terakhir, `accessibilityRole/Label/State`. Ekstrak ke `src/components` hanya bila dipakai ≥ 2 layar dan punya peran bernama.
- **Tombol (pil):** `accent` kuning (CTA utama layar — mis. Masuk, Mulai sikat gigi), `primary` biru, `secondary` lavender, `ghost` (tautan), `inverse` (putih di atas biru), `danger` (hanya aksi destruktif). Satu CTA utama per layar. Tekan: skala pegas 0,96 (Reanimated) — **jangan** `TouchableOpacity`; baris daftar berubah latar, bukan "squish".
- **Lapisan tekan (wajib, ADR 011):** `Pressable` (sentuh + a11y + tata letak) → `Animated.View` (transform saja) → `View` (kelas visual). Jangan pasang `className` pada komponen Reanimated dan jangan `cssInterop` pada Pressable animasi.
- **Daftar & bagian:** grup putih membulat + hairline dengan **ikon tile berwarna** di kiri (referensi 1), **bukan kartu terpisah per baris**; kartu dipakai untuk hal yang memang "satu objek" (streak, hasil, anak), tidak bersarang.
- **Hero:** blok biru penuh dengan sudut bawah membulat & blob (`HeroHeader`) di bawah header navigasi transparan — judul/kembali tetap milik navigator.
- **Navigasi:** judul dari header Stack (bukan `<Text>` buatan; Beranda memakai blok sapaan karena tab akar tanpa kembali); tab bawah putih menempel (tidak melayang) dengan **indikator pil biru** di belakang ikon aktif + label (gaya M3; label wajib untuk anak); tombol kembali sistem.
- **Sheet/dialog:** sheet bawah dengan handle & geser-tutup; `Alert` hanya untuk aksi tak terbalikkan yang jarang (mis. hapus data) — rutin = bisa **Urungkan**. Validasi form = inline, bukan alert. Sukses = UI berubah, bukan "Berhasil!".
- **Empat state per layar berdata:** loading (skeleton bila tata letak diketahui) ≠ kosong ≠ error ≠ konten. Jangan tampilkan "Belum ada data" saat muat pertama. Offline = status normal, bukan error; tampilkan status sinkron yang jelas.
- **Keyboard:** tombol utama form tak boleh tertutup (pakai `react-native-keyboard-controller`); `keyboardShouldPersistTaps="handled"`.
- **Safe area:** inset atas & bawah dari header/tab/`contentInsetAdjustmentBehavior`, tanpa `marginTop: 50`.

## 7. Gerak & umpan balik
- **Gerak ada alasan:** konfirmasi tindakan, panduan perhatian (posisi gigi), hadiah, transisi spasial. Bukan dekorasi.
- **Gerbang frekuensi:** animasi masuk hanya untuk momen langka (hadiah, selesai sikat, onboarding pertama). Layar rutin **langsung muncul** — tanpa `FadeInDown.delay(i*100)` di tiap daftar.
- Hanya `transform`/`opacity`, di UI runtime (Reanimated worklet). Interaksi yang digerakkan jari → pegas (bisa diinterupsi); sisanya kurva waktu. Durasi: `fast 150 / base 250 / slow 400` ms.
- Hormati **"kurangi gerakan"** OS: ganti dengan fade pendek/tanpa gerak; layar darurat tak pernah beranimasi.
- **Umpan balik = suara + visual + teks** (jangan hanya suara; HP sering senyap). Kesalahan anak → petunjuk visual positif (panah/sorot), bukan teks merah.
- Haptik tipis untuk konfirmasi (pastikan tidak mengganggu); bisa dimatikan.
- Uji gerak pada **build rilis di HP paling lemah** — simulator & dev build tidak dihitung.

## 8. Etika gamifikasi (P6)
Boleh: lencana, streak memaafkan, laporan mingguan, mode keluarga. **Dilarang:** iklan, pembelian dalam app, mata uang virtual yang dijual, hitung-mundur menekan ("hadiah hilang dalam 10 menit!"), notifikasi bernada rasa bersalah, tombol "jangan tinggalkan aku", peringkat publik anak, berbagi foto/identitas anak, perbandingan antaranak di kelas yang mempermalukan. Notifikasi pengingat: netral, bisa dijadwal & dimatikan orang tua.

## 9. Aksesibilitas (ringkas; sumber: app/CLAUDE.md §8)
Kontras ≥ AA (teks ≥ 4,5:1; komponen UI ≥ 3:1) · teks ≥ 16sp & skala mengikuti OS · target ≥ 48dp (anak ≥ 56dp) dengan jarak ≥ 8dp · `accessibilityLabel` untuk semua ikon-saja · TalkBack: urutan baca logis, status (dipilih/nonaktif/memuat) diumumkan · jangan hanya warna · instruksi penting punya audio · uji dengan Accessibility Scanner + TalkBack manual.

## 10. Anti-slop — daftar periksa & penegakan otomatis
Dasar: 20 "tell" generik dari skill `expo-design-system` (`native-slop.md`), disesuaikan ke app Android-only dan konteks anak/medis.

**Tell tambahan khusus proyek:**
| Tell | Kenapa buruk di sini |
|---|---|
| "Stat palsu"/angka mengesankan ("99% akurat", "10.000 gigi dianalisis") | Klaim tak tervalidasi (ADR 002), melanggar P2 |
| Salib medis + biru klinik + foto stok senyum-sempurna | Generik, dingin, tidak mewakili anak desa |
| Gradien ungu/pink "AI" & ikon ✨ untuk "AI-powered" | Slop visual; menyiratkan klaim berlebihan |
| Glassmorphism/blur | Berat di HP murah (P4) |
| Gambar karies besar/menyeramkan | Menakutkan anak; bukan fungsi skrining |
| Carousel onboarding promosi sebelum tugas | Tunda fungsi; onboarding hanya bila perlu (consent, usia, izin) |
| Spinner penuh layar antar-state | Gunakan skeleton/status; offline bukan error |
| Hitung-mundur/streak yang memalukan | Dark pattern (P6) |

**Penegakan (CI, bagian dari "selesai" app/CLAUDE.md §9):**
```bash
# run from app/
# 1) forbidden phrases in localisation files -> Jest test (see ../CLAUDE.md §3.1)
# 2) literals outside the theme
grep -rnE '#[0-9a-fA-F]{3,8}\b' src app --include='*.tsx' | grep -v 'src/core/theme'
grep -rnE "(padding|margin|gap|fontSize)\w*:\s*[0-9]" src app --include='*.tsx'   # review each
# 3) tells (review-each)
grep -rn 'TouchableOpacity\|TouchableHighlight\|TouchableWithoutFeedback' src app --include='*.tsx'
grep -rn 'Alert\.alert\|<Modal\|LinearGradient\|headerShown:\s*false\|tabBarStyle' src app --include='*.tsx'
grep -rn 'allowFontScaling={false}\|elevation:\|shadowColor' src app --include='*.tsx'
# 4) emoji as UI glyph (advisory)
rg -n '[\p{Emoji_Presentation}\x{FE0F}]' src app -g '*.tsx'
```
Screenshot-only (periksa manual): kartu bersarang, kotak 1px di semua kontainer, sheet tanpa handle, safe-area bertabrakan, tab melayang, kebingungan hierarki.

## 11. Daftar periksa review layar (centang sebelum merge)
- [ ] Tugas utama layar jelas; **satu** tombol utama.
- [ ] Layar hasil/rujukan: level = warna+ikon+kata; disclaimer + CTA rujukan; tanpa frasa terlarang; tanpa klaim akurasi.
- [ ] Red flag tidak bisa dilewati; layar darurat tanpa maskot/animasi, jalan offline.
- [ ] Semua nilai dari token; tak ada hex/ukuran literal tanpa komentar alasan.
- [ ] Target ≥ 48dp (anak ≥ 56dp); label a11y; kontras AA; uji font 200%.
- [ ] Empat state (loading/kosong/error/konten); jalan di mode pesawat.
- [ ] Gerak: hanya transform/opacity; hormati kurangi-gerakan; bukan animasi masuk di layar rutin.
- [ ] Tak ada emoji-ikon, `TouchableOpacity`, kartu bersarang, gradien dekoratif, blur.
- [ ] Tak ada PII/foto di log; izin diminta kontekstual.
- [ ] Dicoba di ≥ 1 HP mid-range nyata, build rilis.

## 12. Keputusan menyimpang dari default skill Expo (catat di ADR bila berubah)
| Default skill | Keputusan DentisAI | Alasan |
|---|---|---|
| Warna dari semantik OS (`Color.*`), dinamis di Android 12+ | **Warna merek & status eksplisit** (light mode saja) | Arti level triase harus tetap; identitas merek; kontras diuji otomatis |
| SF Symbols (iOS) | **Material Icons saja** | App Android-only |
| `@expo/ui` Compose sebelum komponen RN | Boleh dipakai bila lolos spike S1–S5 & lisensi (tema Material → perlu cek kustomisasi merek) | Verifikasi kompatibilitas SDK 57 `[PERLU VERIFIKASI]` |
| Coba Expo Go dulu | **Development build** | Vision Camera, fast-tflite, SQLCipher tak jalan di Expo Go (ADR 004) |
| Font sistem default | **Plus Jakarta Sans** (OFL) ter-bundel 5 bobot | Referensi visual; lisensi diverifikasi |
| "CSS dan Tailwind tidak didukung — pakai inline style" (`expo-native-ui`) | **NativeWind v4 + React Native Reusables** (ADR 011); inline style hanya untuk nilai runtime (touch target per mode, warna ikon/SVG, opsi navigasi) | Permintaan pemilik produk; desain ulang menulis ulang semua visual |
| Plugin Expo memuat skill `eas-*` berbayar | Abaikan di jalur kritis | ADR 008 (Rp0) |

## 13. Terbuka / langkah berikut
1. Drg pembimbing menyetujui **kata level triase** & contoh bahasa awam (belum ada drg → tanpa klaim klinis).
2. Telaah gambar 8 shot Dribbble (riset §2) → papan suasana; 3 arah maskot orisinal.
3. ✅ Token, komponen, dan tema v3 (ADR 011). Berikutnya: komisi ilustrasi maskot (pose lengkap §4) menggantikan SVG placeholder.
4. ✅ Font: Plus Jakarta Sans (OFL, tercatat di `LICENSES.md`).
5. Uji keterbacaan & kegunaan dengan 5 anak kelas 4 SD (butuh KEPK bila melibatkan data anak — lihat CLAUDE.md §8: **belum ada**, jadi uji awal hanya prototipe tanpa pengumpulan data pribadi dan seizin sekolah/orang tua).
6. Uji font scale 200% pada semua komponen di HP nyata (tema gelap tidak dikirim).
