# Dependency licenses (app/)

Required by `app/CLAUDE.md` §3.11 (closed repo, permissive licenses only; no AGPL/GPL). Read from `node_modules/*/package.json` on 2026-10-09. Update this file whenever a dependency is added.

## Runtime dependencies (shipped in the app)
| Package | Version | License |
|---|---|---|
| @expo-google-fonts/plus-jakarta-sans | 0.4.2 | MIT (package) AND OFL-1.1 (font files) — 400/500/600/700/800 weights bundled |
| @expo/ui | 57.0.22 | MIT |
| @expo/vector-icons | 15.1.1 | MIT |
| @rn-primitives/checkbox | 1.5.2 | MIT |
| @rn-primitives/slot | 1.5.2 | MIT |
| @rn-primitives/switch | 1.5.2 | MIT |
| @supabase/supabase-js | 2.117.3 | MIT |
| class-variance-authority | 0.7.1 | Apache-2.0 |
| clsx | 2.1.1 | MIT |
| expo | 57.0.27 | MIT |
| expo-camera | 57.0.6 | MIT — still photos for screening (ADR 016); no microphone, no barcode scanner |
| expo-constants | 57.0.21 | MIT |
| expo-device | 57.0.2 | MIT |
| expo-file-system | 57.0.7 | MIT — deletes temporary photos |
| expo-font | 57.0.4 | MIT |
| expo-image | 57.0.5 | MIT |
| expo-image-manipulator | 57.0.21 | MIT — crop, re-encode (drops EXIF), downscale |
| expo-keep-awake | 57.0.2 | MIT |
| expo-linking | 57.0.12 | MIT |
| expo-router | 57.0.25 | MIT |
| expo-secure-store | 57.0.4 | MIT |
| expo-splash-screen | 57.0.9 | MIT |
| expo-status-bar | 57.0.1 | MIT |
| expo-system-ui | 57.0.4 | MIT |
| expo-web-browser | 57.0.3 | MIT |
| jpeg-js | 0.4.4 | BSD-3-Clause — decodes the downscaled photo for the quality gate |
| nativewind | 4.2.7 | MIT |
| react | 19.2.3 | MIT |
| react-dom | 19.2.3 | MIT |
| react-native | 0.86.3 | MIT |
| react-native-css-interop | 0.2.7 | MIT |
| react-native-gesture-handler | 2.32.0 | MIT |
| react-native-reanimated | 4.5.1 | MIT |
| react-native-safe-area-context | 5.7.0 | MIT |
| react-native-screens | 4.26.2 | MIT |
| react-native-svg | 15.15.4 | MIT |
| react-native-url-polyfill | 4.0.0 | MIT |
| react-native-web | 0.21.4 | MIT |
| react-native-webview | 13.16.1 | MIT |
| react-native-worklets | 0.10.1 | MIT |
| tailwind-merge | 2.6.1 | MIT |
| zustand | 5.0.15 | MIT |

## Dev dependencies (not shipped)
| Package | Version | License |
|---|---|---|
| @testing-library/react-native | 14.1.0 | MIT |
| @types/jest | 29.5.14 | MIT |
| @types/node | 22.20.5 | MIT |
| @types/react | 19.2.18 | MIT |
| eslint | 9.39.5 | MIT |
| eslint-config-expo | 57.0.2 | MIT |
| jest | 29.7.0 | MIT |
| jest-expo | 57.0.5 | MIT |
| tailwindcss | 3.4.19 | MIT |
| typescript | 6.0.3 | Apache-2.0 |

## Transitive tree (all of node_modules)
Mostly MIT / ISC / Apache-2.0 / BSD. Non-standard entries, all **build or test tooling, not in the app bundle**:
- `lightningcss` (MPL-2.0) — CSS minifier used by Metro for web.
- `node-forge` (BSD-3-Clause OR GPL-2.0, BSD chosen) — Expo CLI code signing.
- `caniuse-lite` (CC-BY-4.0), `argparse` (Python-2.0) — build tooling data/CLI parsing.
- `exit` (MIT, declared in a legacy `licenses` field) — Jest.
- `lightningcss` ~1.27 (MPL-2.0) — also pulled in by `react-native-css-interop` (build-time CSS compile for NativeWind).

Code adapted from React Native Reusables (MIT, founded-labs/react-native-reusables): `src/components/ui/{text,button,input,switch,checkbox}.tsx`, `src/lib/utils.ts`.

No AGPL/GPL-only package. Re-run the scan before each release.

## Assets
| Asset | Source | License |
|---|---|---|
| Plus Jakarta Sans font (400–800) | The Plus Jakarta Sans Project Authors, via `@expo-google-fonts/plus-jakarta-sans` | SIL Open Font License 1.1 (verified in `LICENSE_FONT`, 2026-10-09); shown in-app under Tentang |
| Mascot "Gigi" + decorative shapes (`src/components/mascot.tsx`, `decor.tsx`) | Drawn for DentisAI by the team (original SVG) | Project-owned; placeholder until commissioned art |
| assets/images/* (icon, splash, adaptive icon, favicon) | Expo `default@sdk-57` template placeholders | MIT (Expo template) — **replace with original art before release** |
