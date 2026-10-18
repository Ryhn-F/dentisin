# CLAUDE.md — Frontend / Mobile Engineer (Expo · React Native · TypeScript) · DentisAI

> Berlaku untuk semua pekerjaan di `app/`. Baca juga `../CLAUDE.md` (prinsip wajib) dan dokumen riset di `../docs/research/`. Konflik: **root CLAUDE.md menang**, kecuali ADR berstatus *Accepted*.
> Stack ditetapkan di **ADR 004** (Expo menggantikan Flutter). Kode & komentar: Inggris. Teks UI: Bahasa Indonesia sederhana (mode anak ≈ kelas 4 SD).

## 1. Peran & batas tanggung jawab
Kamu membangun aplikasi Android (Expo) yang **bekerja penuh tanpa internet**: onboarding + persetujuan, kuesioner red flag, pemotretan terpandu + quality gate, inferensi on-device, triase, rujukan PDF, rekomendasi pasta gigi, streak sikat gigi (kamera depan; video bukti opsional, ADR 017/018), kartu edukasi statis, akun orang tua/remaja/anak (ADR 017; mode kader/guru dihapus, ADR 018), dan sinkronisasi saat ada sinyal. **Chatbot ditunda (ADR 008).**

**Milikmu:** `app/**`, implementasi TypeScript mesin triase & rekomendasi (membaca aturan yang dibundel), UI/UX, aksesibilitas, kinerja on-device, DB lokal terenkripsi, outbox sinkron, klien API.
**Bukan milikmu (minta lewat issue/ADR):** `triage/rules.yaml`, `recommender/*.json`, `ml/**`, `backend/**`, `supabase/**`, isi klinis (ambang, red flag, kandungan). Kamu **mengimplementasikan** yang tertulis di sana.

## 2. Baca dulu
1. `../docs/research/00_executive_summary.md`
2. **`../docs/PRD.md`** (sumber kebenaran produk) dan `../docs/decisions/` — **004 (Expo), 005 (Supabase/FastAPI), 007 (TTS), 008 (kendala: repo tertutup, Rp0, chatbot ditunda)**, 001–003
3. `../docs/research/03_ai_components.md` §3.2, §3.4 · `04_architecture.md` · `05_ethics_regulation.md`

## 3. Aturan yang tidak boleh dilanggar
1. **Bahasa "indikasi", bukan diagnosis.** Dilarang di string UI: "Anda menderita", "diagnosis", "pasti", "positif karies", "tidak perlu ke dokter", "bebas karies" (tanpa disclaimer). Daftar di `../docs/style/forbidden_phrases.md`; buat **lint/test yang gagal** bila string UI memuatnya (Jest memindai berkas lokalisasi).
2. **Setiap layar hasil punya CTA rujukan** + "Hasil ini bukan diagnosis dan tidak menggantikan pemeriksaan dokter gigi." Hasil 🟢 tetap menyarankan skrining ulang 3–6 bulan.
3. **Red flag menang.** Kuesioner gejala dijalankan **sebelum** foto; jika ada red flag → layar darurat penuh, tersedia offline.
4. **Offline-first.** Skrining, triase, rekomendasi, streak, edukasi, rujukan PDF harus jalan di mode pesawat. Tidak ada fitur inti yang bergantung jaringan.
5. **Privasi anak (UU PDP Ps. 4 & 25; PP Tunas).**
   - Persetujuan granular & tercatat: (a) simpan lokal, (b) kirim data teknis terpseudonim, (c) unggah foto, (d) video bukti sikat gigi (ADR 017/018) — **opt-in terpisah, default mati**.
   - DB terenkripsi (SQLCipher); foto disimpan terenkripsi (lihat §4); kunci di Android Keystore lewat `expo-secure-store`. Hapus EXIF/lokasi. Foto tidak masuk galeri publik.
   - **Frame/video sikat gigi tidak ditulis ke disk atau dikirim**, kecuali **video bukti** (ADR 017/018, consent d): hanya akun anak dengan `proof_allowed` atau remaja dengan consent (b)+(d), direkam **tanpa suara**, disimpan di folder privat app (bukan galeri) sampai terunggah ke bucket `brushing_proofs`, lalu dihapus dari HP; server menghapusnya otomatis setelah `limits.proof_retention_days`.
   - Tanpa iklan, tanpa SDK pelacak/advertising ID, tanpa profiling, tanpa lokasi presisi ke server. Analitik hanya agregat anonim & lewat tinjauan.
   - Mode anak: tanpa tautan keluar, tanpa input teks bebas (kecuali layar masuk akun anak). Akun anak hanya dibuat orang tua (ADR 017); tanpa hasil skrining, foto, rujukan, atau pengaturan.
   - Log & crash report **tanpa PII/foto/teks pengguna** (cek konfigurasi Sentry/dll. sebelum dipasang).
6. **Maskot dan aset orisinal.**
7. **Rekomendasi kandungan, bukan merek.** Kandungan/ppm dulu; contoh produk dari `products.json` (≥ 2, netral). Selalu: "Pasta gigi membantu, tetapi tidak menambal gigi berlubang."
8. **Feature flag `medical_modules`** (ADR 002): deteksi dan triase berbasis foto di belakang flag; **default mati** pada build publik hingga status regulasi jelas. Modul non-medis (streak, edukasi) tidak bergantung pada flag.
9. **Tidak ada klaim angka akurasi** di UI/ store listing sebelum validasi.
10. **Chatbot ditunda (ADR 008)** — jangan membangun UI chat/LLM. **Jangan memanggil layanan AI/TTS pihak ketiga dari app**; jangan menambahkan SDK/ kunci Gemini atau Vertex AI (syaratnya melarang aplikasi anak/medis, ADR 006).
11. **Repo tertutup + anggaran Rp0 (ADR 008):** hanya dependensi berlisensi permisif/ gratis; **jangan** memasukkan Ultralytics/YOLOv8 atau pustaka AGPL/GPL ke app; catat lisensi dependensi di `LICENSES.md`; tidak ada layanan berbayar di jalur kritis.

## 4. Stack (ADR 004; ubah lewat ADR)
| Area | Pilihan | Catatan terverifikasi / yang harus dibuktikan |
|---|---|---|
| Framework | **Expo SDK 57**, TypeScript strict, Expo Router | New Architecture selalu aktif (SDK 55+). Semua library harus kompatibel |
| Build | EAS Build, **development build** (bukan Expo Go) | Library native & SQLCipher tidak jalan di Expo Go |
| Kamera & frame | `react-native-vision-camera` **v5** (+ `react-native-worklets`, resize plugin) | v5 berbasis Nitro; plugin frame processor = modul Nitro. Pada v4 model harus "di-box" untuk worklet; v5 tidak. Verifikasi versi yang cocok dengan SDK 57 saat spike |
| Inferensi deteksi | `react-native-fast-tflite` (v3, Nitro) delegasi `android-gpu` / default; plugin config `enableAndroidGpuLibraries`; tambahkan `tflite` ke `assetExts` Metro | NNAPI deprecated di Android 15 → jangan jadikan default. Bandingkan CPU vs GPU di HP uji |
| MediaPipe (sikat gigi) | **Spike**: `expo-vision-camera-v4-mediapipe` vs modul native sendiri (Expo Module/Nitro) | Paket komunitas dibangun untuk VisionCamera v4; kompatibilitas v5/SDK 57 **belum diverifikasi** |
| DB lokal | `expo-sqlite` dengan `useSQLCipher: true` | Kunci: `PRAGMA key` tepat setelah buka DB; kunci acak disimpan di `expo-secure-store`; perubahan perlu binary baru |
| Foto | Simpan sebagai BLOB terenkripsi di DB (jumlah kecil, JPEG terkompres) **atau** enkripsi berkas AES-GCM — putuskan di spike S4 | Pustaka enkripsi berkas: [PERLU VERIFIKASI] |
| State | Zustand (dipilih 2026-10-09) | |
| UI / styling | **NativeWind v4 + React Native Reusables + Reanimated** (ADR 011); token di `src/core/theme` → `tailwind.config.ts` | Komponen Reanimated: inline style saja; kelas di `View` biasa (lihat `pressable-scale.tsx`) |
| PDF rujukan | `expo-print` (HTML → PDF di perangkat) + `expo-sharing` | [PERLU VERIFIKASI] di SDK 57 |
| Audio | Aset audio ter-bundel (dibuat dari **Azure Speech S0** saat build — ADR 007; bukan Gemini TTS) + `expo-audio`; sertakan `MANIFEST.json` dan label "suara dibuat dengan AI" di layar Tentang | `expo-av` sudah dihapus pada SDK baru — pakai `expo-audio`. Cek ketersediaan suara TTS perangkat sebelum bergantung pada `expo-speech` |
| Auth & sinkron | **Supabase Auth: email + password** (konfirmasi email aktif; SMTP gratis — ADR 008; **tanpa SMS OTP**; reset password via email; CAPTCHA) + outbox kustom ke Supabase RPC (ADR 005, 008) | PowerSync hanya bila ada kebutuhan sinkron dua arah |
| Klien data | `@supabase/supabase-js` (auth, RPC, storage). Klien FastAPI: hanya `POST /v1/screening/evaluate` sebagai pemeriksaan ulang hasil skrining (ADR 019; `EXPO_PUBLIC_API_BASE_URL`); hasil HP selalu berlaku bila server tidak tersedia | |
| Uji | Jest + `@testing-library/react-native`, Maestro/Detox untuk alur E2E offline | |

## 5. Struktur yang disarankan
```
app/                       # self-contained (ADR 010)
  src/
    app/                   # Expo Router screens: (onboarding) (screening) (brushing) (class) (settings)
    core/                  # theme, a11y, i18n (id), feature flags, result/error types
    data/                  # sqlcipher db, migrations, repositories, outbox, api client
    domain/                # entities; triage/ & recommender/ (TS, pure functions)
    features/              # consent symptom-check capture result referral recommend brushing education class-mode history child-mode
    ml/                    # detector (fast-tflite wrapper), quality-gate, brushing-tracker bridge
  assets/                  # model/ rules/ audio/ illustrations/ (original)
  __tests__/               # unit + parity + lint (forbidden phrases)
  e2e/                     # Maestro flows (airplane mode)
  app.config.ts · eas.json · metro.config.js
```

## 6. Spesifikasi fitur utama

### 6.1 Triase (TypeScript)
- Port **murni & deterministik** dari `triage/rules.yaml`; ambang dibaca dari berkas aturan yang dibundel (`assets/rules/`), bukan hard-code; `version` tampil di "Tentang".
- Output `{level, reasons[], teeth[], advice_ids[], referral_template_id}`.
- **Tes paritas wajib:** jalankan `../triage/tests/cases.json` (kasus yang sama dengan pytest). Cakup semua level, kasus batas, kombinasi red flag; cakupan 100% pada engine.
- UI level: **warna + ikon + kata**. 🔴 Darurat / 🟠 Segera / 🟡 Terjadwal / 🟢 Rutin.

### 6.2 Pemotretan & quality gate
- Pandangan prioritas MVP: **gigi depan, bibir ditarik/tersenyum** (ADR 003). Posterior/oklusal = mode kader.
- Overlay posisi, ajakan nyalakan senter, hitung-mundur, umpan balik langsung (teks+ikon+suara): "Bibir menutupi gigi — tarik sedikit", "Terlalu gelap — nyalakan senter", "Goyang — tahan HP".
- Gate sebelum inferensi: blur (varian Laplacian), kecerahan, **gigi terlihat**. Ambang di konfigurasi. Referensi: hanya 45% foto orang tua diagnostik pada uji AICaries → retake yang ramah adalah fitur utama. Hitung metrik pada resolusi turun (downscale) dan jalankan di worklet agar JS thread tidak macet.
- Catat lokal (tanpa PII) alasan penolakan untuk memperbaiki panduan.

### 6.3 Hasil deteksi
Overlay **kotak per temuan** (model v1 = detektor bounding box, ADR 001/003) dengan palet ramah buta-warna; label sederhana. Triase memakai jumlah lesi dan ukuran relatif box. `caries_noncavitated` tampil sebagai "perlu perhatian" (kepercayaan rendah), tidak menaikkan level sendirian (ADR 003). Tampilkan batasan: "Foto tidak bisa melihat gigi di sela-sela atau bagian dalam."

### 6.4 Sikat gigi (streak)
- Timer 2 menit hanya berjalan saat wajah terdeteksi dan ada gerakan tangan/sikat di area mulut. Jika kamera gagal/HP lemah → **fallback timer + musik** tanpa kamera (jangan blokir streak).
- Streak berbasis **jendela waktu**: pagi (setelah sarapan) & malam (sebelum tidur) sesuai definisi SKI 2023 (hanya 6,2% menyikat pada waktu benar). Jendela dapat diatur.
- Umpan balik "Sekarang gigi belakang kiri bawah ya!" = **panduan permainan**, bukan penilaian klinis; tampilkan "skor semangat".
- Anti-curang: wajah hidup, gerakan bervariasi, durasi gerak minimum. Tanpa simpan video.
- Target ≥ 15 FPS stabil di HP mid-range **setelah 2+ menit** (throttling). Ukur, jangan asumsikan. Pemrosesan frame di worklet/native; JS hanya menerima ringkasan (mis. event per 200 ms).
- Gamifikasi etis: lencana, streak, mode keluarga, laporan mingguan. Tanpa iklan/pembelian dalam app/dorongan konsumtif.

### 6.5 Rekomendasi pasta gigi (v1: fluoride)
`recommend(detections, age, allergies, prefs)` (TS) dari `recommender/rules.json`. Tampilkan ppm + jumlah pakai per usia (parameter JSON), "awasi anak sampai ≥ 7 tahun", "jangan banyak berkumur setelah menyikat". Filter alergi/halal/SLS. Merek hanya dari `products.json`.

### 6.6 Edukasi (chatbot ditunda)
Kartu edukasi statis dari aset (cara sikat, kapan ke dokter, fluoride, persiapan kunjungan), bersumber pedoman, tanpa input teks bebas (FR-70, P1). **Tidak ada fitur chat/LLM pada MVP.**

### 6.7 Mode kader/guru — DIHAPUS (ADR 018)
> Tidak dibangun lagi: peran kader, roster kelas, dan rekap fasilitas dihapus. Bagian di bawah hanya arsip.

Skrining batch satu kelas: daftar murid pseudonim (nomor absen/inisial), antrean foto, rekap kelas per level, ekspor rekap untuk puskesmas, sinkron saat online. Persetujuan orang tua per murid tercatat **sebelum** foto.

### 6.8 Sinkronisasi & pembaruan
- Outbox: tabel `outbox(event_id, type, payload, created_at, attempts)`; kirim berurutan, idempoten per `event_id`, backoff, hanya metadata terpseudonim default; unggahan besar hanya via Wi-Fi bila diatur.
- Aturan & model: unduh manifes **bertanda tangan Ed25519** dari Supabase Storage (bucket publik), **verifikasi tanda tangan + checksum**, simpan versi aktif + rollback. **Jangan** mengirim aturan klinis/model lewat EAS Update tanpa melewati change control (ADR 002).
- Auth: Supabase Auth email+password. Tautan konfirmasi/ reset diarahkan ke halaman statis `https://app.ryhnfir.dev/auth/callback` yang membuka app lewat deep link (`dentisai://auth/callback`) — daftarkan skema di `app.config.ts` dan di Redirect URLs Supabase; tangani sesi dari deep link. SMTP bawaan hanya 2 email/jam dan hanya anggota tim → **wajib SMTP kustom gratis** (**Resend Free + `auth.ryhnfir.dev`**, ADR 008; batas 100 email/hari); mode anak tanpa akun. Free plan Supabase **dijeda setelah 1 minggu tanpa aktivitas** — app harus tetap berfungsi penuh offline dan menampilkan status sinkron yang jelas.

## 7. Kinerja & spike (ADR 004)
Siapkan "device lab" ≥ 3 HP: RAM 3/4/6 GB (Snapdragon 4xx–6xx / Helio / Unisoc). Jalankan **S1–S5** di ADR 004 sebelum membangun fitur di atasnya dan catat di `app/docs/benchmarks.md`: latensi foto→hasil (< 1,5 s), memori puncak, ukuran AAB (usulan < 60 MB awal), cold start, FPS sikat gigi, suhu/baterai setelah 2 menit. Semua angka di dokumen riset = **hipotesis**.

## 8. Aksesibilitas & bahasa
Teks ≥ 16sp dapat diperbesar (hormati font scale OS), kontras WCAG AA, area sentuh ≥ 48dp, `accessibilityLabel` lengkap & dukungan TalkBack, ikon + teks, instruksi audio. Bacaan kelas 4 SD untuk mode anak ("lubang gigi" bukan "kavitas"); uji dengan 5 anak sebelum rilis. Tidak menampilkan foto lubang besar yang menakutkan di mode anak.

## 9. Tes & definisi selesai
- `npx tsc --noEmit`, `npx eslint .`, `npx jest` (unit, paritas triase, lint frasa terlarang), Maestro E2E untuk alur offline (mode pesawat).
- Tes bahwa tidak ada permintaan jaringan saat alur skrining offline; DB tidak terbaca tanpa kunci; tidak ada PII di log.
- Fitur selesai bila: jalan di mode pesawat · lulus a11y dasar · tak ada PII di log · string lolos lint · ada tes · dicoba di ≥ 1 HP mid-range nyata (build rilis, bukan Metro dev).
- Jangan commit foto pasien, dataset, atau API key. Gambar contoh = sintetis/berlisensi, dicatat di `assets/LICENSES.md`. Rahasia hanya di EAS Secrets / `.env` yang di-ignore.

## 10. Perintah
```bash
cd app && npm install            # atau pnpm/yarn sesuai keputusan tim
npx expo install --check         # selaraskan versi dengan SDK 57
npx expo prebuild --clean        # setelah mengubah config plugin (SQLCipher, fast-tflite)
npx expo run:android --variant release
eas build --profile development --platform android
npx tsc --noEmit && npx eslint . && npx jest
maestro test e2e/                # E2E offline
```

## 11. Pertanyaan terbuka yang memblokir kamu
1. Hasil spike S1–S5 (ADR 004) — jangan membangun fitur kamera/ML di atas asumsi.
2. Pilihan MediaPipe: paket komunitas vs modul native sendiri.
3. Hasil bake-off model (ADR 001) menentukan format keluaran `labels.json` (SSD vs YOLOX); ADR 002 (build publik vs pilot).
4. Nilai klinis `PLACEHOLDER` di `triage/rules.yaml`; red flag final dari drg.
5. Minimum Android/RAM & target ukuran (butuh survei HP sekolah mitra).
6. Pemulihan akun untuk orang tua tanpa email aktif (reset oleh admin); mode keluarga multi-perangkat (menentukan perlu-tidaknya PowerSync).
7. **KEPK belum ada** → fitur `dataset_contribution` (FR-25) dibangun di belakang flag **mati** dan tidak diaktifkan; foto anak tidak diunggah. Layar consent (c) harus menyebut penyimpanan di Singapura, tujuan, akses, retensi, hak tarik.
