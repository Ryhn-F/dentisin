# DentisAI (Dentisin) — mobile app (Expo SDK 57)

DentisAI is an Android app that helps families in Indonesia look after children's teeth. It builds a twice-a-day brushing habit, offers a guided photo screening that **indicates** whether a dentist visit is needed (it never diagnoses), recommends fluoride toothpaste by age, and teaches with short education cards. It is built offline-first, with privacy for minors as a hard rule, and every UI text is plain Bahasa Indonesia.

The app is self-contained (ADR 010). Read `CLAUDE.md` (rules), `docs/design_principles.md` (design) and `docs/app_plan.md` (pages + phases) before changing anything.

> **Streak rule: brushing can only be recorded in the morning and evening windows.**
>
> | Window | Local time | Notes |
> |---|---|---|
> | Pagi (morning) | **06.00–09.00** | end exclusive |
> | Malam (evening) | **20.00–23.00** | end exclusive |
>
> - Outside these hours the brushing session refuses to start and shows when the next window opens (`brushing.blocked.outsideWindow`).
> - One session per window per day. A second try in the same window is refused (`morningDone` / `eveningDone`).
> - A streak day needs at least one session of `streak_min_duration_s` (server limit, default 60 s). Because sessions can only start inside a window, every streak day was brushed in the morning or the evening; either window lights the day.
> - Times use the phone's clock. The window start decides the slot of a session.
> - Source of truth: `src/domain/brushing-windows.ts` (display + target duration) and `slotForTime()` / `brushingBlock()` in `src/domain/streak.ts` (the hours that are enforced). Change both together. `backend/ml/brushing/brushing_rules.yaml` still holds older placeholder windows (product decision of 2026-10-19 overrides them).

## What the app does

### Who uses it
Three kinds of account, decided by the server (`my_account()`), never guessed on the client (ADR 017/018):

| Account | Created by | Can do |
|---|---|---|
| Parent (`guardian`) | signs up with email + password | manages child profiles and up to 6 child accounts (server limit), screening, referral, consents, watches proof videos of their children, deletes data |
| Teen (`teen`, 15–19) | signs up for themself | the same for their own profile, including their own proof videos |
| Child (`child`) | only a parent; logs in with parent email + username + password | brushing and streak, proof video (needs parent consent), asks the parent for a screening. No screening results, photos, referrals or settings |
| No account | "Pakai tanpa akun" | everything works locally, nothing is sent; signing in later syncs |

The kader / teacher class mode was removed (ADR 018).

### Features
- **Brushing streak.** A 2-minute guided timer with a four-zone voice guide (pre-generated audio), a week view with morning/evening dots and a streak counter. Only open in the two windows above. The camera is optional; any camera problem falls back to the plain timer, so the streak never depends on the camera. Optional proof video: recorded without sound at about 480p, kept in a private app folder, uploaded to a private bucket, deleted from the phone after upload and removed by the server after the retention period. It needs separate opt-in consent (d) and is off by default.
- **Photo screening** (tab in the middle). Red-flag questions, symptoms and pain, a photo guide, camera with torch and countdown, an on-device quality gate (blur, brightness, teeth visible), then triage. The result shows three levels (Segera, Sedang, Baik) with colour, icon and word, a dentist-referral call to action, and a letter that works offline. Red-flag answers raise the level but the flow continues (ADR 021). Never shows a diagnosis, and "Baik" still advises a re-check in 3–6 months. Behind the `medical_modules` flag, **off in public builds** and on only in internal builds (ADR 002). Treat all triage values as proposals until the supervising dentist signs them off.
- **Toothpaste recommendation.** Fluoride content (ppm) and amount by age, with allergy, halal and SLS filters. It recommends ingredients, not brands.
- **Education cards.** Static cards: how to brush, when to see a dentist, fluoride, visit preparation. No free-text input.
- **History.** Brushing, screenings and referrals per child, with sync state per item.
- **Family tools.** Child switcher, screening requests from children, proof video player, consent manager per child, sync status screen, data and account deletion requests.
- **Privacy.** No ads, no tracking SDKs, no chatbot (ADR 008). Pseudonymous data only: child nicknames stay on the device and the server never receives a name.

## Architecture

```
┌──────────────────────── Android app (Expo, offline-first) ─────────────────────────┐
│  Expo Router screens ──► feature modules ──► domain (pure TS) ──► local store      │
│       (src/app)           (src/features)      streak · triage     (src/data)       │
│                                   │                                     │          │
│                                   ▼                                     ▼          │
│                          core services (src/core)              outbox (src/core/sync)│
│                          auth · account · api · i18n · theme            │          │
└───────────────────────────────────┬─────────────────────────────────────┼──────────┘
                                    │                                     │
                 Supabase Auth, RPC, Storage, Edge Functions     rpc sync_events(batch)
                 (email + password, Turnstile CAPTCHA)           idempotent, FIFO per child
                                    │
                 DentisAI API (FastAPI, ADR 019/020): POST /v1/screening/photo and /evaluate
```

**Layers**
- **UI**: Expo Router routes in `src/app`, design-system components in `src/components`, NativeWind v4 styling with tokens from `src/core/theme`.
- **Features**: screen logic grouped by topic in `src/features` (brushing, screening, home, history, child accounts, proofs, requests, deletion, sync).
- **Domain**: pure, deterministic TypeScript in `src/domain`: the streak maths, the triage engine (parity-tested against the backend cases) and shared models.
- **Local data**: `src/data/local-store.ts` is a Zustand store persisted through `appStorage`, a chunked SecureStore (Android Keystore) wrapper with crash-safe A/B slot writes (`persist.ts`). Data is scoped per user, plus a `guest` scope for no-account mode. Screening photos are not stored.
- **Sync**: every change is built as a whitelisted event (`src/core/sync/events.ts`) and queued in a per-user outbox. Events are sent in FIFO batches per child to the `sync_events` RPC with idempotent `event_id`, exponential backoff and a 60 s foreground retry. Guest mode never sends anything, and names never leave the phone.
- **Screening**: the questionnaire and the triage engine run on the phone. With consent (b) and a connection, the photo goes to `POST /v1/screening/photo` (the API does not store it) and the server result is used. If the server is unavailable, the on-device result stands. Screenings without a photo use `POST /v1/screening/evaluate`.
- **Auth**: Supabase Auth only (see the contract below). Sessions are kept in SecureStore, and the app starts fully offline.
- **Account routing**: `my_account()` decides the home screen (guardian, teen, child, guest, or an onboarding gate); the root layout guards routes with `Stack.Protected`.

**Stack**: Expo SDK 57, React Native 0.86 (New Architecture), TypeScript strict, Expo Router, NativeWind v4 + React Native Reusables, Reanimated, Zustand, `@supabase/supabase-js`, `expo-camera`, `expo-audio`, `expo-video`, `expo-secure-store`, Jest + Testing Library.

## Setup
```bash
npm install
cp .env.example .env.local   # fill in Supabase URL/anon key + Turnstile site key (public values only)
```
Expo also reads `app/.env` (git-ignored). Without Supabase values the app still runs fully in **no-account mode** ("Pakai tanpa akun"); sign-in/sign-up show a "server belum diatur" notice. `EXPO_PUBLIC_API_BASE_URL` points to the screening API; leave it empty to evaluate on the device only.

Internal builds (Metro/dev client, or `EXPO_PUBLIC_INTERNAL_BUILD=true`) turn `medical_modules` on so the screening flow can be tested with draft rules. `EXPO_PUBLIC_MEDICAL_MODULES=false` turns it off there too.

## Commands (run from `app/`)
```bash
npm run web          # quick visual preview in a browser (not the product target; CAPTCHA is Android-only)
npm start            # Expo dev server
npx expo run:android # development build (needed for SecureStore/WebView behaviour on device)
npm test             # Jest: contrast, forbidden phrases, components, auth, sync, streak, triage parity, design lint
npm run typecheck
npm run lint
npm run check        # typecheck + lint + test
npx expo install --check && npx expo-doctor
```
Add packages with `npx expo install <pkg>` (SDK-compatible versions). In PowerShell, pass the dev flag as `npx expo install <pkg> '--' --save-dev`.

## Layout
```
src/app/                     Expo Router routes
  index.tsx                  entry gate
  (entry)/                   welcome, login, register, child-login, check-email   (signed-out only)
  (tabs)/                    home, features, screening, history/*, profile/*      (guardian, teen, guest)
  brushing/session.tsx       2-minute timer (full-screen modal; guardian, teen, guest and child)
  screening/                 questions, symptoms, guide, camera, review, result, referral  (medical_modules)
  feature/                   toothpaste, education/*
  kid/                       the child account's own small app
  proofs/, requests/         proof videos, screening requests from children
  onboarding/teen-setup.tsx, account-gate.tsx
  auth/                      callback (dentisai://auth/callback), reset-password, forgot-password (any state)
  privacy.tsx, dev/theme.tsx privacy summary; design gallery (__DEV__ only, via About)
src/features/                screen logic by topic (brushing, screening, home, history, child-accounts, …)
src/domain/                  streak.ts, brushing-windows.ts, triage/ (pure engine), models.ts
src/data/                    local-store.ts (Zustand), persist.ts (crash-safe storage)
src/core/theme/              the ONLY place for hex colors and tokens (+ fonts, navigation header options)
src/core/auth/               Supabase client, session store, auth service, validation, CAPTCHA, deep-link parser
src/core/account/            my_account(), child-account API, routing
src/core/sync/               events, outbox, bridge, engine
src/core/api/                DentisAI screening API client
src/core/i18n/               id.ts + features/* (all UI strings) + forbidden-phrases.ts
src/core/config.ts, flags.ts EXPO_PUBLIC_* runtime config; medical_modules / dataset_contribution
src/components/              design-system components (Button, Card, ListGroup, FeatureTile, StreakWeek, …)
src/ml/                      photo handling, quality gate, detector types
src/ui/format.ts             date/duration formatting (Indonesian)
__tests__/                   Jest tests
```

## Auth (backend contract)
Supabase Auth only (FastAPI has no auth endpoints). Sources: `backend/supabase/config.toml [auth]`, `backend/web/{auth/callback,captcha}`, `backend/docs/runbooks/auth-setup.md`, mailer `smtp-handler/`.

| Topic | Contract | App |
|---|---|---|
| Password | min **8**, lower + upper + digit | `src/core/auth/validation.ts` (live checklist) |
| Sign-up | email confirmation required; existing emails get the same answer (no enumeration) | `signUp()` → `/check-email` (resend cooldown 60 s = `max_frequency`) |
| Email links | mailer → `<SUPABASE_URL>/auth/v1/verify` → `EXPO_PUBLIC_AUTH_REDIRECT_URL` = **`https://app.ryhnfir.dev/auth/callback`** → `dentisai://auth/callback?code=…` (PKCE) | `src/app/auth/callback.tsx`; reset links detected via `redirectType: "recovery"` |
| CAPTCHA | Turnstile host page `<origin>/captcha/?sitekey=…&action=…` posts `{type:"turnstile",token}` / `{type:"turnstile_error",code}` | `src/core/auth/{captcha,use-captcha}.ts`, `components/turnstile.tsx`; token on sign-up, sign-in, resend, reset; never blocks a submit (server decides) |
| Profile | signup trigger creates `guardian` row + role | account type read from `my_account()`, cached for offline |
| Errors | GoTrue `error_code` | fixed Indonesian texts in `src/core/auth/errors.ts`, incl. mailer-hook failures and the 60 s email limit |

Web preview sends no CAPTCHA token (no WebView); test CAPTCHA on Android.

## Styling (ADR 011)
- NativeWind v4 (`className`) with tokens from `src/core/theme` exposed via `tailwind.config.ts` (single source). Classes: `bg-primary`, `bg-sun`, `bg-coral`, `text-ink`, `text-ink-soft`, `text-title`, `rounded-card`, …
- UI primitives adapted from React Native Reusables live in `src/components/ui/` (Text, Button, Input, Switch, Checkbox, PressableScale); merge classes with `cn()` from `src/lib/utils.ts`.
- Reanimated components take **inline styles only**; put classes on a plain `View` inside (see `pressable-scale.tsx`).
- `useTheme()` only for runtime values (mode-dependent touch targets, icon/SVG colors, navigation options).

## Rules of thumb
- Components read tokens via `useTheme()`; screens use components. No hex outside `src/core/theme` (design-lint test fails).
- All UI text goes in `src/core/i18n/id.ts` (and `src/core/i18n/features/*`); the forbidden-phrase test scans it, including template functions. Use "indikasi", never "diagnosis".
- Auth errors are mapped to fixed Indonesian messages (`src/core/auth/errors.ts`); raw server text is never shown and the UI never reveals whether an email is registered.
- Triage level words and recommender values are **proposals** until the supervising dentist approves them.
- Logs and crash reports carry no PII, photos or user text.
