# Installable app (PWA)

CampusConnect can be installed on phones, tablets and desktops and then opens in its own window. This is built with the platform's own pieces (no PWA library).

| Piece | Where |
|---|---|
| Web App Manifest (`/manifest.webmanifest`) | `src/app/manifest.ts` — name and short name CampusConnect, `display: standalone`, scope `/`, theme `#101210`, background `#eef5e8` (the design tokens in `globals.css`), orientation any |
| Icons | `public/icons/` — 192, 512, a 512 **maskable** icon and a 180 Apple touch icon, drawn from the real logo mark; regenerate with `node scripts/generate-icons.mjs` |
| Start URL | `/app` (`src/app/app/route.ts`): a signed-in user lands on their own home, everyone else on sign-in. It reveals nothing to anonymous callers |
| Service worker | `public/sw.js`, registered in production only by `src/components/pwa/pwa-provider.tsx` |
| Offline page | `public/offline.html` + `offline.css` (static, no scripts, no private content) |
| Install UI | `src/components/pwa/install-card.tsx`: a dismissible card in the portal (`variant="card"`) and an always-available explanation in Notification preferences (`variant="inline"`) |
| Update handling | the provider checks for a new worker hourly and when the tab becomes visible; a new one waits, a small "Update" banner applies it and reloads |
| Headers / CSP | `/sw.js` is served `no-cache` with `Service-Worker-Allowed: /` (`next.config.ts`); the CSP gained `worker-src 'self'` |

## Caching: deliberately tiny
Cached: the offline page and its icon (at install), and build-hashed files under `/_next/static/` and `/icons/` (identical for everyone). **Nothing else is intercepted or stored**: no pages, no API responses, no documents, no downloads. A signed-out or different user can therefore never be served someone else's data from a cache, and there is nothing private to clean up at sign-out. Navigations are network-only; when the network is gone the offline page is shown. Cache names carry a version (`cc-sw-v1`); older versions are deleted when a new worker activates. Bump `VERSION` in `public/sw.js` to force a clean-out.

Sign-out (`SignOutForm`) additionally switches this device's push alerts off for the account that is leaving and clears our caches and `sessionStorage` before the server ends the session.

## Install experience
* Chrome/Edge/Android browsers: the card appears only when the browser has offered installation (`beforeinstallprompt`), triggers the native prompt, handles accept/decline, and disappears once installed (`appinstalled`, or standalone display mode).
* iPhone/iPad Safari (no prompt exists): the card explains **Share → Add to Home Screen**.
* "Later" hides the card for 14 days (localStorage). It never shows when the app is already installed.
* Browsers without an install prompt (Firefox desktop, Safari desktop): the Notification preferences page explains how to use the browser's own menu.

## Platform support (what we tested and what we could not)
| Platform | Install | Push |
|---|---|---|
| Android Chrome and other Chromium browsers | yes | yes (not exercised on a real device in this repo) |
| Desktop Chrome / Edge | yes | yes |
| Desktop Firefox | no install prompt | push works in the browser |
| iOS / iPadOS Safari 16.4+ | Add to Home Screen | only from the installed home-screen app |
| Other iOS browsers | follow Safari rules | same |

Automated tests run in Chromium. Real-device behaviour (Android, iOS, Edge, Firefox) was **not** tested here and is not claimed.

## Limits
Offline use is limited to the offline page: the application needs the network for all data. Push depends on the operating system, browser, permission and connectivity.
