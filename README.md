# DentisAI — app (Expo SDK 57)

Self-contained frontend (ADR 010). Read `CLAUDE.md` (rules), `docs/design_principles.md` (design) and `docs/app_plan.md` (pages + phases) first.

## Setup
```bash
npm install
cp .env.example .env.local   # fill in Supabase URL/anon key + Turnstile site key (public values only)
```
Expo also reads `app/.env` (git-ignored). Without Supabase values the app still runs fully in **no-account mode** ("Pakai tanpa akun"); sign-in/sign-up show a "server belum diatur" notice.

## Commands (run from `app/`)
```bash
npm run web          # quick visual preview in a browser (not the product target; CAPTCHA is Android-only)
npm start            # Expo dev server
npx expo run:android # development build (needed for SecureStore/WebView behaviour on device)
npm test             # Jest: contrast, forbidden phrases, components, auth, design lint
npm run typecheck
npm run lint
npm run check        # typecheck + lint + test
npx expo install --check && npx expo-doctor
```
Add packages with `npx expo install <pkg>` (SDK-compatible versions). In PowerShell, pass the dev flag as `npx expo install <pkg> '--' --save-dev`.

## Layout
```
src/app/                     Expo Router routes
  index.tsx                  entry gate → /welcome or /home
  (entry)/                   welcome, login, register, check-email   (signed-out only)
  (tabs)/                    home, features, history/*, profile/*     (signed-in or no-account)
  auth/                      callback (dentisai://auth/callback), reset-password, forgot-password (any state)
  brushing/session.tsx       2-minute timer (modal)
  feature/                   toothpaste, education/*
  privacy.tsx, dev/theme.tsx privacy summary; design gallery (__DEV__ only, via About)
src/core/theme/              the ONLY place for hex colors and tokens (+ fonts, navigation header options)
src/core/auth/               Supabase client, session store (zustand), auth service, validation, deep-link parser
src/core/i18n/               id.ts (all UI strings) + forbidden-phrases.ts
src/core/config.ts           EXPO_PUBLIC_* runtime config
src/core/flags.ts            medical_modules / dataset_contribution (both off)
src/components/              design-system components (Button, Card, ListGroup, FeatureTile, StreakWeek, …)
src/domain/                  app-side types aligned with backend tables
src/mock/                    PHASE 2 prototype data (in memory) — replaced by the local DB in phase 4
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
| Profile | signup trigger creates `guardian` row + role | roles read from `user_role` (RLS: own rows), cached for offline |
| Errors | GoTrue `error_code` | fixed Indonesian texts in `src/core/auth/errors.ts`, incl. mailer-hook failures and the 60 s email limit |

Web preview sends no CAPTCHA token (no WebView); test CAPTCHA on Android.

## Styling (ADR 011)
- NativeWind v4 (`className`) with tokens from `src/core/theme` exposed via `tailwind.config.ts` (single source). Classes: `bg-primary`, `bg-sun`, `bg-coral`, `text-ink`, `text-ink-soft`, `text-title`, `rounded-card`, …
- UI primitives adapted from React Native Reusables live in `src/components/ui/` (Text, Button, Input, Switch, Checkbox, PressableScale); merge classes with `cn()` from `src/lib/utils.ts`.
- Reanimated components take **inline styles only**; put classes on a plain `View` inside (see `pressable-scale.tsx`).
- `useTheme()` only for runtime values (mode-dependent touch targets, icon/SVG colors, navigation options).

## Rules of thumb
- Components read tokens via `useTheme()`; screens use components. No hex outside `src/core/theme` (design-lint test fails).
- All UI text goes in `src/core/i18n/id.ts` (the forbidden-phrase test scans it, including template functions).
- Auth errors are mapped to fixed Indonesian messages (`src/core/auth/errors.ts`); raw server text is never shown and the UI never reveals whether an email is registered.
- Triage level words and recommender values are **proposals** until the supervising dentist approves them.
