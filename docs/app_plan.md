# DentisAI app — Design theme v2 + feature plan (8 pages)

> Status: **PLAN v0.2 (2026-10-09)** — phases 1–3 built (see §8). Light mode only (decision 2026-10-09).
> Built on: `design_principles.md` (rules), `../CLAUDE.md` (constraints), `docs/PRD.md` (FR-xx), and the **implemented backend** in `../../backend/` (read 2026-10-09).
> Anything marked **[DECIDE]** needs an owner decision; **[DRG]** needs the supervising dentist.

---

## 1. What the backend actually gives the app (and what it doesn't)

| Need | Backend reality | Consequence for the app |
|---|---|---|
| Login / register | **Supabase Auth** email + password. Password ≥ 10 chars with lower + upper + digit. Email confirmation **on**. CAPTCHA (hCaptcha/Turnstile) **on** for sign-up / sign-in / reset. Redirect `dentisai://auth/callback`. Anonymous sign-in **off**. | Register form validates the same password rule client-side. Needs a CAPTCHA widget: **Cloudflare Turnstile** in a WebView (decided). Deep-link handler for confirm + reset. |
| Data writes | **Only through RPC `sync_events(batch)`** (outbox, idempotent `event_id`). Event types: `consent_changed`, `child_upserted`, `screening_recorded`, `brushing_recorded`, `referral_created`, `image_upload_registered`. Payload keys are whitelisted. | App writes **local DB first**, queues events, syncs when online. Order for a new child: `consent_changed` (a, b) → `child_upserted` → data. |
| Profile data | `guardian` = id + locale only. `child_profile` = birth year/month + allergy codes. **No names stored server-side, ever** (whitelist rejects them). | Child **nickname lives only on the device** (encrypted). Profile page shows the email from Auth + local nicknames. |
| Roles | `guardian`, `kader`, `facility_viewer`, `admin` in `user_role` (read-only to the user). Signup always becomes `guardian`. | Kader features (class mode) appear only if the role is `kader`. |
| Consent | `consent` rows per child × type (a/b/c), withdraw = set `withdrawn_at`. Withdrawing (b) stops all sync for that child. | Account settings → consent manager per child. |
| Deletion | RPC `request_deletion('child', id)` / `request_deletion('account')`; job deletes and leaves a proof. | Account settings → "Hapus data anak" / "Hapus akun", with status. |
| Feature flags | `feature_flag` table (`medical_modules`, `dataset_contribution`), readable by users. | Flags fetched + cached; **default off** when offline/unknown. |
| Rules / model | Signed manifests in Storage bucket `manifests`; `triage/dist/rules.json`, `recommender/dist/recommender.json`, `ml/brushing/brushing_rules.yaml`. | Bundled copies in `app/assets/rules/` (sync script, ADR 010); TS ports with parity tests against backend `tests/cases.json`. |
| Brushing / streak | Rules: windows morning 06:00–10:00, evening 19:00–23:00 (configurable), zone Asia/Jakarta (WITA/WIT selectable), `streak_requires: both` (PLACEHOLDER), target 120 s, "skor semangat" 0–100. Event `brushing_recorded {started_at, duration_s, spirit_score, slot, camera_mode}`. | Home streak card + brushing session. Port `checkin.py` + `brushing_score.py` to TS. |
| Triage | Draft rules, **all PLACEHOLDER, 0 of 30 dentist-graded cases** → "must not be used on children". | Screening stays behind `medical_modules = false`; the Features page shows it as "Segera hadir". |
| Recommender | Fluoride v1, draft, products are placeholders → `release_check` fails. | Show the conservative `status.generic_message` until signed off **[DRG]**. |
| FastAPI | Admin-only (review queue, model registry). | **The app never calls FastAPI.** |
| Free plan | Supabase pauses after ~1 week idle. | Offline-first; sync status always visible; never block on network. |

**Account vs. no-account (FR-01/FR-04, decided):** Login has a third path, **"Pakai tanpa akun"**: everything works locally, no sync. Signing in later uploads the outbox.

---

## 2. Design theme v2 — "Bersih-hangat, modern"

> **Superseded 2026-10-09 by theme v3 "playful & bold"** (ADR 011, `design_principles.md` §3): blue/yellow/coral on lavender, NativeWind v4 + React Native Reusables, original SVG mascot. The page structure in §3–§4 is unchanged.

Evolves the existing tokens (`src/core/theme`); same rules (no slop, AA contrast, 48/56dp, light only).

### 2.1 Personality
Calm and trustworthy for parents, warm and playful for kids. **Modern = confident typography, generous space, soft tinted surfaces and one strong accent**, not gradients, glass or heavy shadows.

### 2.2 Color additions (keep current palette; add tints)
| Token | Hex (proposal) | Use |
|---|---|---|
| `bg` | `#FFFDF8` (kept) | page |
| `surface` | `#E8F3F1` (kept) | grouped sections |
| `card` | `#FFFFFF` | raised cards on bg (with `shadows.card`) |
| `tint.mint` | `#DDF3EC` | brushing tile / streak |
| `tint.sky` | `#E1EEFB` | screening tile |
| `tint.peach` | `#FDE7DA` | toothpaste tile / rewards |
| `tint.lemon` | `#FCF1C9` | education tile |
| `primary` | `#0B6F6A` (kept) | main actions, active tab |
| `accent` | `#C2410C` (kept) | streak flame / reward highlight only |
| `success` text | `#1E7A46` (= routine level) | "done" check-ins |

Tints are **backgrounds only**; text on them stays `text`/`textSecondary`. All new pairs are added to `contrastPairs` (test stays green).

### 2.3 Type
- **Brand font proposal: Plus Jakarta Sans** (Indonesian-designed, OFL, **license [PERLU VERIFIKASI]**), bundled with `expo-font` (weights 400/600/700/800 only), for headings and numbers (decided). Body stays system Roboto for size and readability.
- Big numbers (streak count, timer) use `display` 40–56sp + `tabular-nums`.

### 2.4 Shape, elevation, icons, imagery
- Radius: cards 20, tiles 24, buttons 14, chips full. `borderCurve: 'continuous'`.
- Elevation: only `card` (subtle) for cards on `bg`; grouped lists use `surface` + hairlines.
- Icons: Material Icons (one family). The Rounded variant is not in `@expo/vector-icons` 15, so the filled set is used.
- Mascot (original, to commission): appears on Splash, Home greeting, empty states, brushing session. Never on result/emergency screens.
- Illustrations: flat, 2–3 tint colors + primary, no realistic teeth/lesions.

### 2.5 Motion (Reanimated, transform/opacity only)
- Press: subtle scale 0.98 on tiles/buttons; rows use a background highlight.
- Streak check-in: one-time pop and flame scale when a slot completes (respect reduce-motion).
- Brushing ring: progress arc animates with the timer.
- Screens: no entrance animations on routine screens.

### 2.6 New components (in `src/components/`)
`Card`, `ListGroup` + `ListRow` (settings style), `FeatureTile`, `StreakWeek` (7 days × morning/evening dots), `StreakCounter`, `ProgressRing`, `TextField`, `PasswordField` (show/hide + rule checklist), `Chip`, `SegmentedControl`, `ChildSwitcher`, `SyncStatusPill`, `Banner` (info/warn), `EmptyState` (mascot + one line + one action), `SectionHeader`. Existing: `ThemedText`, `Button`, `LevelBadge`, `ConsentCard`.

---

## 3. Navigation map (Expo Router, `src/app/`)

```
src/app/
  _layout.tsx                 Root: ThemeProvider, SessionProvider, DB provider, splash control
  index.tsx                   Gate: restore session/local state → redirect
  (auth)/_layout.tsx          Stack, no tabs
    welcome.tsx               (= Splash hand-off / first run: role choice)
    login.tsx
    register.tsx
    forgot-password.tsx
    callback.tsx              deep link dentisai://auth/callback (confirm / reset)
  (tabs)/_layout.tsx          JS bottom tabs: Beranda · Fitur · Skrining (raised center) · Riwayat · Profil
    home.tsx
    features.tsx
    history/index.tsx
    history/[id].tsx          detail (screening / brushing / referral)
    profile/index.tsx
    profile/child/[id].tsx    edit child (nickname local, birth y/m, allergies)
    profile/settings.tsx      Account settings
    profile/consents.tsx
    profile/about.tsx
  brushing/session.tsx        full-screen modal (timer, camera later)
  features/toothpaste.tsx
  features/education/[slug].tsx
  features/screening/...      behind medical_modules (not built in this plan)
```
Tabs = 5 destinations with icon + label (child-friendly, always visible); **Skrining sits in the middle as a raised round button** (main feature, 2026-10-10). While `medical_modules` is off, the Skrining tab explains how screening will work ("Segera hadir") and offers brushing / "Kapan ke dokter gigi?". Account settings is a stack screen under Profil, not a tab.

---

## 4. Pages

Each page lists **purpose · content · data source · states · acceptance**. All strings go to `i18n/id.ts`.

### 4.1 Splash
- **Native splash** (`expo-splash-screen`): bg `#FFFDF8`, mascot or logo mark centered. Held only while: fonts load, the secure-store key and local DB open, and the Supabase session is restored from secure storage (**no network wait**).
- Then route: no local state → `welcome`; session or "no-account" mode → `home`.
- Acceptance: cold start < 3 s on a 3 GB phone (ADR 004 S5); works in airplane mode; no spinner screen.

### 4.2 Login (`(auth)/login`)
- **Content:** mascot header; email; password (show/hide); "Lupa kata sandi?"; primary "Masuk"; secondary "Daftar akun baru"; tertiary **"Pakai tanpa akun"**; CAPTCHA (invisible/managed).
- **Data:** `supabase.auth.signInWithPassword({ email, password, options: { captchaToken } })`; session persisted via `expo-secure-store` adapter.
- **States:** inline field errors; "Email belum dikonfirmasi" (with resend action); offline banner ("Butuh internet untuk masuk; kamu tetap bisa pakai tanpa akun"); rate-limited message.
- **Acceptance:** keyboard never covers the button; errors inline (no alerts); TalkBack labels.

### 4.3 Register (`(auth)/register`)
- **Content:** email; password with a live checklist (≥ 10 karakter, huruf besar, huruf kecil, angka); confirm password; agree to the privacy notice (link to in-app text, from `backend/docs/regulatory/PRIVACY_NOTICE_DRAFT.md`); "Daftar".
- **After submit:** "Cek email kamu" screen (with resend after 60 s, mindful of the 10 emails/hour limit). Confirmation link → `callback` → home.
- **Not here:** child data and consents. Those come at first child setup (Profile), recorded via `consent_changed`.
- **Acceptance:** client validation = server rule; no name field (backend stores none).

### 4.4 Home (`(tabs)/home`)
```
┌ Halo! [maskot]   [ChildSwitcher ▾]   [SyncStatusPill]
│ ┌ Streak card (tint.mint) ───────────────────────┐
│ │  [ikon api]  12 hari berturut-turut          │
│ │  Sen Sel Rab Kam Jum Sab Min                     │
│ │  ●●  ●●  ●●  ●○  ●●  ○○  ··   (pagi/malam)       │
│ │  Pagi ✓ sudah   Malam: 19.00–23.00               │
│ │  [ Mulai sikat gigi (2 menit) ]  (primary, large) │
│ └─────────────────────────────────────────────────┘
│ Fitur (2×2 FeatureTiles): Sikat gigi · Pasta gigi · Edukasi · Skrining (Segera hadir)
│ Pengingat: "Periksa rutin ke dokter gigi tiap 6 bulan" card (static)
│ Terakhir: last brushing + last screening summary → Riwayat
└
```
- **Data:** local DB (brushing events, check-ins) + TS port of `checkin.py` (windows, zone, `streak_requires`). Child from local profiles (nickname local).
- **Brushing session (modal):** v1 = **fallback timer + music** (FR-61; no camera until spikes S2/S3). The ring fills over 120 s; pause/resume; end screen with the mascot sleepy "selesai" (session close). It saves `brushing_event` locally plus `brushing_recorded {slot, duration_s, spirit_score: null, camera_mode: false}` to the outbox.
- **States:** no child yet → EmptyState "Tambah profil anak" (goes to Profile); outside the windows → shows the next window time; streak broken → gentle message, no red.
- **Acceptance:** streak math passes the backend `ml/brushing/tests/cases.json` streak/check-in cases (parity).

### 4.5 Features (`(tabs)/features`)
Grid of `FeatureTile`s (icon, title, one-line description, tint):

| Tile | v1 status | Target |
|---|---|---|
| Sikat gigi 2 menit | **Active** | brushing session |
| Rekomendasi pasta gigi | **Active (generic message until [DRG])** | `features/toothpaste` → TS port of `recommend.py` using `recommender/dist/recommender.json`; age from child; allergy/halal/SLS filters; mandatory sentence |
| Kartu edukasi | **Active** | static cards (cara sikat, kapan ke dokter, fluoride, persiapan kunjungan) with sources |
| Skrining foto gigi | **"Segera hadir"** (flag `medical_modules` off) | later: questionnaire → red flag → capture → result |
| Surat rujukan | Hidden until screening ships | FR-43 |
| Mode kelas | Only if role = `kader`; "Segera hadir" | FR-80 |
| Cari faskes | P1, hidden | FR-44 |

Disabled tiles say why ("Menunggu pengesahan dokter gigi") and never fake a working feature.

### 4.6 History (`(tabs)/history`)
- **Content:** SegmentedControl **Sikat gigi | Skrining | Rujukan** + child filter. List grouped by month (`ListGroup`), each row: date, slot or level badge, duration or level word. Weekly summary at the top for brushing (days completed, average duration).
- **Detail** `history/[id]`: brushing (time, duration, slot); screening (LevelBadge, reasons, disclaimer + referral CTA; feature-flagged); referral (PDF re-open).
- **Data:** local DB only (FR-90, encrypted); shows per-item sync state (synced / waiting).
- **States:** empty (EmptyState per segment), loading skeleton; never a full-screen spinner.

### 4.7 Profile (`(tabs)/profile`)
- **Header:** account email (or "Mode tanpa akun" + "Masuk untuk sinkron" button), role chip (Orang tua / Kader).
- **Anak saya:** list of child rows (nickname — "hanya tersimpan di HP ini", age from birth year/month); "Tambah anak". Add or edit child = nickname (local), birth month/year pickers, allergy chips (codes from recommender filters). The first child triggers the **consent flow** (3 ConsentCards; (a) required to save locally, (b) to sync, (c) hidden while `dataset_contribution` is off).
- **Shortcuts:** Pengaturan akun · Persetujuan data · Tentang aplikasi.
- **Kid mode switch:** "Mode anak" (bigger targets, simpler text) as a local preference.

### 4.8 Account settings (`profile/settings`)
`ListGroup`s:
1. **Akun:** email (read-only), ubah kata sandi (reset-email flow), keluar (sign out; local data stays unless the user deletes it).
2. **Pengingat sikat gigi:** morning/evening windows (time pickers), time zone WIB/WITA/WIT, streak rule display.
3. **Data & privasi:** consents per child (withdraw → `consent_changed` with action withdraw; the explanation shows what stops); sync status + "Sinkron sekarang"; "Unduh/ekspor data saya" (P1).
4. **Hapus:** "Hapus data anak" → `request_deletion('child', id)`; "Hapus akun" → `request_deletion('account')`. Each shows a native confirmation (irreversible, rare), then a status row (Diproses / Selesai).
5. **Tentang:** app version, rules/model versions, licenses (`LICENSES.md`), "suara dibuat dengan AI" label (FR-122/121).

---

## 5. Data layer (needed by every page)

| Piece | Choice | Note |
|---|---|---|
| Supabase client | `@supabase/supabase-js` + `expo-secure-store` storage adapter (chunk large sessions) | anon key + URL via `app.config.ts` extra / EAS env (not secrets) |
| Local DB | `expo-sqlite` (+ **SQLCipher after spike S4**, ADR 004) | Tables mirror the backend + local-only `child_local(nickname)`, `outbox` |
| Outbox | `outbox(event_id, type, payload, created_at, attempts, status, code)` → batches of ≤ 100 to `sync_events` | Handle each result code: `consent_required` → prompt consent; `internal_error` → retry the same id; others terminal |
| State | **Zustand** (small; per app/CLAUDE.md "pick one") **[DECIDE]** | session, active child, prefs |
| Rules assets | `scripts/sync-backend-assets.mjs` copies `backend/*/dist/*` + checksums → `assets/rules/` | the app never imports `../backend` (ADR 010) |
| Domain (TS, pure) | `src/domain/brushing/checkin.ts`, `src/domain/recommender/recommend.ts` (+ later `triage`) | parity tests run backend `cases.json` |

---

## 6. Delivery phases (each ends green: typecheck · lint · jest · visual check)

| # | Phase | Output | Depends on |
|---|---|---|---|
| 1 | **Design system v2** | tokens (tints, card, font), new components, updated preview gallery, contrast tests | font decision |
| 2 | **Navigation skeleton** | all routes above with static UI + mock data; tabs; splash gate | 1 |
| 3 | **Auth** | login, register, forgot, callback, session persistence, no-account mode, CAPTCHA | Supabase project URL/keys, CAPTCHA provider, redirect page live |
| 4 | **Local data + sync** | SQLite repos, child profiles + consents, outbox → `sync_events`, flags fetch, SyncStatusPill | 3 (sync part); spike S4 for SQLCipher |
| 5 | **Home + brushing** | streak (TS `checkin` + parity), fallback timer session, check-in recording | 4 |
| 6 | **History + Profile + Settings** | lists/details, child CRUD, consent manager, windows, deletion requests | 4, 5 |
| 7 | **Features** | toothpaste (TS recommender + parity, generic message), education cards, flag-gated tiles | 4 |
| 8 | **Hardening** | E2E Maestro offline flows, a11y pass (TalkBack, 200% font), dev build on a real 3 GB phone | Android SDK / EAS |

Out of this plan: camera brushing (spikes S2/S3), photo screening / triage UI (flag + dentist sign-off), class mode, referral PDF.

---

## 7. Decisions
Decided 2026-10-09 (product owner):
1. **No-account mode kept:** Login offers "Pakai tanpa akun" (PRD FR-01); signing in later syncs the outbox.
2. **CAPTCHA: Cloudflare Turnstile** (managed/invisible) via `react-native-webview` (MIT). Site key in app config; secret only in the Supabase dashboard.
3. **Font: Plus Jakarta Sans** for headings/numbers (OFL license to be verified and recorded in `LICENSES.md` before bundling); body text in Roboto.
4. **Streak day = morning AND evening** (`streak_requires: both`, matches the backend).

Still open:
5. **[DECIDE]** State library: Zustand (default unless objected).
6. **[DRG]** Level words, recommender values, triage params (unchanged blockers).
7. **Owner TODO (backend README):** Resend SMTP + DNS, callback page `app.ryhnfir.dev/auth/callback`, Turnstile keys, Supabase URL/anon key. Needed before phase 3 can be tested end to end.

---

## 8. Build status

**Phases 1–3 done (2026-10-09).** Verified: `tsc`, `eslint`, Jest (540 tests: contrast incl. non-text 3:1, forbidden phrases incl. template strings, components, auth logic, session store, design lint), `expo install --check`, `expo-doctor` 21/21, and a click-through of every page in the web preview at 375×812.

| Phase | Delivered | Known gaps / deviations |
|---|---|---|
| 1 Design system v2 | Tints, card, success/danger/outline tokens (accent/success darkened slightly to pass AA on tints), Plus Jakarta Sans 600/700/800, 15 new components, dev gallery `/dev/theme` | Filled Material Icons (no Rounded set); no mascot art yet (icon placeholders) |
| 2 Navigation skeleton | All 8 pages + detail screens, JS bottom tabs (76dp + safe-area inset), `Stack.Protected` guards, splash gate | Data is an **in-memory mock** (`src/mock/`) with an on-screen "data contoh" banner; settings rows for reminders/deletion are read-only/"Segera hadir" |
| 3 Auth | Supabase email+password (PKCE), register with password checklist, check-email + resend (60 s cooldown), forgot/change password via email link, deep-link callback (code or tokens; recovery → reset screen), no-account mode, Turnstile WebView, SecureStore chunked session, offline-tolerant hydrate | **Not tested against a real Supabase project** (no keys / SMTP / Turnstile yet) and **not run on an Android device**; Turnstile is a stub on web |

Before phase 3 can be called verified end-to-end: fill `app/.env.local`, finish the backend README owner TODOs (Resend SMTP, callback page, Turnstile keys, redirect URLs), then on an Android dev build run sign-up → email link → home, sign-in, wrong password, unconfirmed email, forgot password → reset, sign-out, and an airplane-mode cold start with an expired token.
